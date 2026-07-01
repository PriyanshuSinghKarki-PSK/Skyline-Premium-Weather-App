/* =========================================================
   SKYLINE WEATHER — APPLICATION LOGIC
   Vanilla JavaScript · OpenWeatherMap API
   ========================================================= */

/* =========================================================
   1. CONFIGURATION
   ========================================================= */

// 🔑 PASTE YOUR OPENWEATHERMAP API KEY BELOW 🔑
// Get a free key at: https://home.openweathermap.org/api_keys
const API_KEY = "418d67761a915d5ff8d93908d40729f0";

const BASE_URL = "https://api.openweathermap.org/data/2.5";
const GEO_URL = "https://api.openweathermap.org/geo/1.0";

const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // refresh every 10 minutes
const MAX_RECENT = 6;
const MAX_FAVORITES = 8;

/* =========================================================
   2. STATE
   ========================================================= */

const state = {
  unit: localStorage.getItem("skyline_unit") || "metric", // metric = °C, imperial = °F
  theme: localStorage.getItem("skyline_theme") || "dark",
  lastCoords: null,
  lastData: null,
  recent: JSON.parse(localStorage.getItem("skyline_recent") || "[]"),
  favorites: JSON.parse(localStorage.getItem("skyline_favorites") || "[]"),
  refreshTimer: null,
  chart: null,
};

/* =========================================================
   3. DOM REFERENCES
   ========================================================= */

const els = {
  loadingScreen: document.getElementById("loadingScreen"),
  errorToast: document.getElementById("errorToast"),
  errorMessage: document.getElementById("errorMessage"),
  errorClose: document.getElementById("errorClose"),

  searchForm: document.getElementById("searchForm"),
  searchInput: document.getElementById("searchInput"),
  voiceBtn: document.getElementById("voiceBtn"),
  locationBtn: document.getElementById("locationBtn"),
  unitToggle: document.getElementById("unitToggle"),
  themeToggle: document.getElementById("themeToggle"),

  recentChips: document.getElementById("recentChips"),
  favoriteChips: document.getElementById("favoriteChips"),

  cityName: document.getElementById("cityName"),
  placeMeta: document.getElementById("placeMeta"),
  dateTime: document.getElementById("dateTime"),
  favBtn: document.getElementById("favBtn"),

  weatherIconGlyph: document.getElementById("weatherIconGlyph"),
  tempValue: document.getElementById("tempValue"),
  weatherDesc: document.getElementById("weatherDesc"),
  feelsLike: document.getElementById("feelsLike"),
  currentStats: document.getElementById("currentStats"),

  highlightsGrid: document.getElementById("highlightsGrid"),
  hourlyScroll: document.getElementById("hourlyScroll"),
  dailyRow: document.getElementById("dailyRow"),

  aqiRing: document.getElementById("aqiRing"),
  aqiNumber: document.getElementById("aqiNumber"),
  aqiLabel: document.getElementById("aqiLabel"),

  alertsCard: document.getElementById("alertsCard"),
  alertsList: document.getElementById("alertsList"),

  sunDot: document.getElementById("sunDot"),
  sunriseTime: document.getElementById("sunriseTime"),
  sunsetTime: document.getElementById("sunsetTime"),
  moonIcon: document.getElementById("moonIcon"),
  moonPhaseLabel: document.getElementById("moonPhaseLabel"),

  tipsList: document.getElementById("tipsList"),

  bgStage: document.getElementById("bgStage"),
  rainLayer: document.getElementById("rainLayer"),
  snowLayer: document.getElementById("snowLayer"),
  starsLayer: document.getElementById("starsLayer"),

  tempChartCanvas: document.getElementById("tempChart"),
};

/* =========================================================
   4. UTILITIES
   ========================================================= */

/** Adds a ripple effect to any clicked button. */
function addRipple(e) {
  const btn = e.currentTarget;
  const circle = document.createElement("span");
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  circle.className = "ripple";
  circle.style.width = circle.style.height = `${size}px`;
  circle.style.left = `${e.clientX - rect.left - size / 2}px`;
  circle.style.top = `${e.clientY - rect.top - size / 2}px`;
  btn.appendChild(circle);
  setTimeout(() => circle.remove(), 650);
}
document.querySelectorAll(".icon-btn, .primary-btn").forEach((btn) => {
  btn.style.position = btn.style.position || "relative";
  btn.style.overflow = "hidden";
  btn.addEventListener("click", addRipple);
});

/** Shows an animated error toast for a few seconds. */
function showError(message) {
  els.errorMessage.textContent = message;
  els.errorToast.classList.add("show");
  clearTimeout(showError._t);
  showError._t = setTimeout(() => els.errorToast.classList.remove("show"), 4500);
}
els.errorClose.addEventListener("click", () => els.errorToast.classList.remove("show"));

/** Toggles the full-screen loader. */
function setLoading(isLoading) {
  els.loadingScreen.classList.toggle("hidden", !isLoading);
}

/** Converts a unix timestamp + timezone offset (seconds) into a readable time string. */
function formatTime(unixSeconds, tzOffsetSeconds = 0) {
  const date = new Date((unixSeconds + tzOffsetSeconds) * 1000);
  return date.toUTCString().match(/\d{2}:\d{2}/)[0];
}

/** Formats the current local date/time for the searched city. */
function formatCityDateTime(tzOffsetSeconds) {
  const now = new Date(Date.now() + tzOffsetSeconds * 1000);
  const options = { weekday: "long", day: "numeric", month: "long" };
  const dateStr = now.toLocaleDateString("en-US", { timeZone: "UTC", ...options });
  const timeStr = now.toUTCString().match(/\d{2}:\d{2}/)[0];
  return `${dateStr} · ${timeStr}`;
}

function unitSymbol() {
  return state.unit === "metric" ? "°C" : "°F";
}
function windUnit() {
  return state.unit === "metric" ? "m/s" : "mph";
}

/** Maps OpenWeatherMap icon codes / condition ids to Font Awesome glyphs. */
function getWeatherIconClass(iconCode, conditionId) {
  const map = {
    "01d": "fa-sun", "01n": "fa-moon",
    "02d": "fa-cloud-sun", "02n": "fa-cloud-moon",
    "03d": "fa-cloud", "03n": "fa-cloud",
    "04d": "fa-cloud", "04n": "fa-cloud",
    "09d": "fa-cloud-rain", "09n": "fa-cloud-rain",
    "10d": "fa-cloud-sun-rain", "10n": "fa-cloud-moon-rain",
    "11d": "fa-cloud-bolt", "11n": "fa-cloud-bolt",
    "13d": "fa-snowflake", "13n": "fa-snowflake",
    "50d": "fa-smog", "50n": "fa-smog",
  };
  return `fa-solid ${map[iconCode] || "fa-cloud"}`;
}

/** Determines a simplified weather "type" used to drive the animated background. */
function getWeatherType(conditionId, isNight) {
  if (conditionId >= 200 && conditionId < 300) return "storm";
  if (conditionId >= 300 && conditionId < 600) return "rain";
  if (conditionId >= 600 && conditionId < 700) return "snow";
  if (conditionId >= 700 && conditionId < 800) return "fog";
  if (conditionId === 800) return isNight ? "night" : "sunny";
  if (conditionId > 800) return isNight ? "night" : "cloudy";
  return "cloudy";
}

/** Switches the animated background layer to match current conditions. */
function setBackground(type) {
  document.querySelectorAll(".bg-layer").forEach((l) => l.classList.remove("active"));
  const map = {
    sunny: ".bg-sun",
    cloudy: ".bg-clouds",
    rain: ".bg-rain",
    snow: ".bg-snow",
    storm: ".bg-storm",
    fog: ".bg-fog",
    night: ".bg-stars",
  };
  const selector = map[type] || ".bg-clouds";
  document.querySelector(selector)?.classList.add("active");

  if (type === "rain" || type === "storm") generateRainDrops();
  if (type === "snow") generateSnowFlakes();
  if (type === "night") generateStars();
}

function generateRainDrops() {
  if (els.rainLayer.childElementCount > 0) return;
  for (let i = 0; i < 60; i++) {
    const drop = document.createElement("span");
    drop.className = "drop";
    drop.style.left = `${Math.random() * 100}%`;
    drop.style.animationDuration = `${0.5 + Math.random() * 0.6}s`;
    drop.style.animationDelay = `${Math.random() * 2}s`;
    els.rainLayer.appendChild(drop);
  }
}

function generateSnowFlakes() {
  if (els.snowLayer.childElementCount > 0) return;
  for (let i = 0; i < 50; i++) {
    const flake = document.createElement("span");
    flake.className = "flake";
    const size = 2 + Math.random() * 4;
    flake.style.width = `${size}px`;
    flake.style.height = `${size}px`;
    flake.style.left = `${Math.random() * 100}%`;
    flake.style.animationDuration = `${4 + Math.random() * 6}s`;
    flake.style.animationDelay = `${Math.random() * 5}s`;
    els.snowLayer.appendChild(flake);
  }
}

function generateStars() {
  if (els.starsLayer.childElementCount > 0) return;
  for (let i = 0; i < 90; i++) {
    const star = document.createElement("span");
    star.className = "star";
    star.style.top = `${Math.random() * 90}%`;
    star.style.left = `${Math.random() * 100}%`;
    star.style.animationDelay = `${Math.random() * 3}s`;
    els.starsLayer.appendChild(star);
  }
}

/* =========================================================
   5. LOCALSTORAGE HELPERS (recent searches / favorites)
   ========================================================= */

function saveRecent(cityLabel) {
  state.recent = [cityLabel, ...state.recent.filter((c) => c !== cityLabel)].slice(0, MAX_RECENT);
  localStorage.setItem("skyline_recent", JSON.stringify(state.recent));
  renderChips();
}

function toggleFavorite(cityLabel) {
  if (state.favorites.includes(cityLabel)) {
    state.favorites = state.favorites.filter((c) => c !== cityLabel);
  } else {
    state.favorites = [cityLabel, ...state.favorites].slice(0, MAX_FAVORITES);
  }
  localStorage.setItem("skyline_favorites", JSON.stringify(state.favorites));
  renderChips();
  updateFavButton(cityLabel);
}

function updateFavButton(cityLabel) {
  const isFav = state.favorites.includes(cityLabel);
  els.favBtn.classList.toggle("active", isFav);
  els.favBtn.innerHTML = isFav ? '<i class="fa-solid fa-star"></i>' : '<i class="fa-regular fa-star"></i>';
}

function renderChips() {
  els.recentChips.innerHTML = state.recent
    .map((c) => `<button class="chip" data-city="${c}"><i class="fa-solid fa-clock-rotate-left"></i>${c}</button>`)
    .join("");
  els.favoriteChips.innerHTML = state.favorites
    .map((c) => `<button class="chip" data-city="${c}"><i class="fa-solid fa-star"></i>${c}</button>`)
    .join("");

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => fetchWeatherByCity(chip.dataset.city));
  });
}

/* =========================================================
   6. CORE FETCH FUNCTIONS (async/await + error handling)
   ========================================================= */

/** Fetches and renders weather for a given city name. */
async function fetchWeatherByCity(city) {
  if (!city || !city.trim()) {
    showError("Please enter a city name.");
    return;
  }
  if (!isApiKeyConfigured()) return;

  setLoading(true);
  try {
    const url = `${BASE_URL}/weather?q=${encodeURIComponent(city)}&units=${state.unit}&appid=${API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 404) throw new Error(`City "${city}" was not found. Check the spelling and try again.`);
      throw new Error("Unable to fetch weather data right now. Please try again.");
    }
    const data = await res.json();
    state.lastCoords = { lat: data.coord.lat, lon: data.coord.lon };
    await loadAllWeatherData(data);
    saveRecent(`${data.name}, ${data.sys.country}`);
  } catch (err) {
    showError(err.message || "Something went wrong while fetching weather data.");
  } finally {
    setLoading(false);
  }
}

/** Fetches and renders weather using GPS coordinates. */
async function fetchWeatherByCoords(lat, lon) {
  if (!isApiKeyConfigured()) return;
  setLoading(true);
  try {
    const url = `${BASE_URL}/weather?lat=${lat}&lon=${lon}&units=${state.unit}&appid=${API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Unable to fetch weather for your location.");
    const data = await res.json();
    state.lastCoords = { lat, lon };
    await loadAllWeatherData(data);
    saveRecent(`${data.name}, ${data.sys.country}`);
  } catch (err) {
    showError(err.message || "Could not detect weather for your location.");
  } finally {
    setLoading(false);
  }
}

/** Orchestrates loading current + forecast + AQI data, then renders the UI. */
async function loadAllWeatherData(currentData) {
  const { lat, lon } = currentData.coord;

  const [forecastData, aqiData] = await Promise.all([
    fetch(`${BASE_URL}/forecast?lat=${lat}&lon=${lon}&units=${state.unit}&appid=${API_KEY}`).then((r) =>
      r.ok ? r.json() : null
    ),
    fetch(`${BASE_URL}/air_pollution?lat=${lat}&lon=${lon}&appid=${API_KEY}`).then((r) => (r.ok ? r.json() : null)),
  ]);

  state.lastData = { current: currentData, forecast: forecastData, aqi: aqiData };
  localStorage.setItem("skyline_last_city", JSON.stringify(state.lastData));

  renderCurrentWeather(currentData);
  if (forecastData) {
    renderHourlyForecast(forecastData, currentData.timezone);
    renderDailyForecast(forecastData, currentData.timezone);
    renderTempChart(forecastData);
  }
  if (aqiData) renderAQI(aqiData);

  document.body.style.background = "none"; // gradient handled by bg-stage layers
  restartAutoRefresh();
}

function isApiKeyConfigured() {
  if (!API_KEY || API_KEY.includes("PASTE_YOUR")) {
    showError("Add your OpenWeatherMap API key in script.js to enable live data.");
    return false;
  }
  return true;
}

/* =========================================================
   7. RENDER FUNCTIONS
   ========================================================= */

function renderCurrentWeather(data) {
  const isNight = !(data.dt > data.sys.sunrise && data.dt < data.sys.sunset);
  const conditionId = data.weather[0].id;
  const type = getWeatherType(conditionId, isNight);
  setBackground(type);

  els.cityName.textContent = data.name;
  els.placeMeta.textContent = `${data.sys.country} · Lat ${data.coord.lat.toFixed(2)}, Lon ${data.coord.lon.toFixed(2)}`;
  els.dateTime.textContent = formatCityDateTime(data.timezone);

  const cityLabel = `${data.name}, ${data.sys.country}`;
  updateFavButton(cityLabel);
  els.favBtn.onclick = () => toggleFavorite(cityLabel);

  els.weatherIconGlyph.className = `${getWeatherIconClass(data.weather[0].icon, conditionId)} weather-icon-glyph`;
  els.tempValue.textContent = `${Math.round(data.main.temp)}${unitSymbol()}`;
  els.weatherDesc.textContent = data.weather[0].description;
  els.feelsLike.textContent = `Feels like ${Math.round(data.main.feels_like)}${unitSymbol()}`;

  const stats = [
    { label: "Humidity", value: `${data.main.humidity}%`, icon: "fa-droplet" },
    { label: "Wind Speed", value: `${data.wind.speed} ${windUnit()}`, icon: "fa-wind" },
    { label: "Pressure", value: `${data.main.pressure} hPa`, icon: "fa-gauge" },
    { label: "Visibility", value: `${(data.visibility / 1000).toFixed(1)} km`, icon: "fa-eye" },
  ];
  els.currentStats.innerHTML = stats
    .map(
      (s) => `<div class="stat-pill"><span class="stat-label"><i class="fa-solid ${s.icon}"></i> ${s.label}</span><span class="stat-value">${s.value}</span></div>`
    )
    .join("");

  renderHighlights(data);
  renderSunMoon(data);
  renderTips(data, conditionId);
}

function renderHighlights(data) {
  const items = [
    { icon: "fa-temperature-half", label: "Feels Like", value: `${Math.round(data.main.feels_like)}${unitSymbol()}` },
    { icon: "fa-cloud", label: "Cloudiness", value: `${data.clouds.all}%` },
    { icon: "fa-droplet", label: "Humidity", value: `${data.main.humidity}%` },
    { icon: "fa-wind", label: "Wind Gust", value: `${data.wind.gust ?? data.wind.speed} ${windUnit()}` },
    { icon: "fa-compass", label: "Wind Direction", value: `${data.wind.deg}°` },
    { icon: "fa-gauge-high", label: "Pressure", value: `${data.main.pressure} hPa` },
  ];
  els.highlightsGrid.innerHTML = items
    .map(
      (i) => `<div class="highlight-item"><i class="fa-solid ${i.icon}"></i><span class="h-label">${i.label}</span><span class="h-value">${i.value}</span></div>`
    )
    .join("");
}

function renderHourlyForecast(forecastData, tzOffset) {
  const next8 = forecastData.list.slice(0, 8);
  els.hourlyScroll.innerHTML = next8
    .map((item) => {
      const time = formatTime(item.dt, 0);
      const icon = getWeatherIconClass(item.weather[0].icon, item.weather[0].id);
      const rainChance = Math.round((item.pop || 0) * 100);
      return `
        <div class="hour-card">
          <span class="hour-time">${time}</span>
          <i class="${icon} hour-icon"></i>
          <span class="hour-temp">${Math.round(item.main.temp)}${unitSymbol()}</span>
          <span class="hour-sub"><i class="fa-solid fa-droplet"></i>${rainChance}%</span>
          <span class="hour-sub"><i class="fa-solid fa-wind"></i>${item.wind.speed}${windUnit()}</span>
        </div>`;
    })
    .join("");
}

function renderDailyForecast(forecastData) {
  // Group 3-hour entries by calendar day, then summarize.
  const byDay = {};
  forecastData.list.forEach((item) => {
    const dateKey = item.dt_txt.split(" ")[0];
    if (!byDay[dateKey]) byDay[dateKey] = [];
    byDay[dateKey].push(item);
  });

  const dayKeys = Object.keys(byDay).slice(0, 5);
  els.dailyRow.innerHTML = dayKeys
    .map((key) => {
      const entries = byDay[key];
      const temps = entries.map((e) => e.main.temp);
      const high = Math.round(Math.max(...temps));
      const low = Math.round(Math.min(...temps));
      const midEntry = entries[Math.floor(entries.length / 2)];
      const icon = getWeatherIconClass(midEntry.weather[0].icon, midEntry.weather[0].id);
      const rainChance = Math.round(Math.max(...entries.map((e) => e.pop || 0)) * 100);
      const date = new Date(key);
      const dayName = date.toLocaleDateString("en-US", { weekday: "short" });
      const dateLabel = date.toLocaleDateString("en-US", { day: "numeric", month: "short" });

      return `
        <div class="day-card">
          <span class="day-name">${dayName}</span>
          <span class="day-date">${dateLabel}</span>
          <i class="${icon} day-icon"></i>
          <span class="day-temp">${high}°<span class="lo">${low}°</span></span>
          <span class="day-rain"><i class="fa-solid fa-droplet"></i>${rainChance}%</span>
        </div>`;
    })
    .join("");
}

function renderAQI(aqiData) {
  const aqi = aqiData.list[0].main.aqi; // 1-5 scale from OpenWeatherMap
  const labels = ["—", "Good", "Fair", "Moderate", "Poor", "Very Poor"];
  const colors = ["#94A3B8", "#22C55E", "#84CC16", "#F59E0B", "#F97316", "#EF4444"];
  const pct = (aqi / 5) * 100;

  els.aqiRing.style.background = `conic-gradient(${colors[aqi]} ${pct * 3.6}deg, var(--glass-border) 0deg)`;
  els.aqiNumber.textContent = aqi;
  els.aqiLabel.textContent = labels[aqi];
  els.aqiLabel.style.color = colors[aqi];
}

function renderSunMoon(data) {
  const { sunrise, sunset } = data.sys;
  const now = data.dt;
  const dayLength = sunset - sunrise;
  const progress = Math.min(Math.max((now - sunrise) / dayLength, 0), 1);

  // Position the dot along the arc path (simple linear approximation across angle 180→0deg)
  const angle = Math.PI * (1 - progress);
  const cx = 100 + 90 * Math.cos(angle);
  const cy = 90 - 90 * Math.sin(angle);
  els.sunDot.setAttribute("cx", cx.toFixed(1));
  els.sunDot.setAttribute("cy", cy.toFixed(1));

  els.sunriseTime.textContent = formatTime(sunrise, data.timezone);
  els.sunsetTime.textContent = formatTime(sunset, data.timezone);

  // Approximate moon phase from current date (29.5-day synodic cycle)
  const synodic = 29.53058867;
  const knownNewMoon = new Date("2000-01-06T18:14:00Z").getTime();
  const daysSince = (Date.now() - knownNewMoon) / 86400000;
  const phaseFraction = ((daysSince % synodic) / synodic + 1) % 1;
  const phases = [
    { name: "New Moon", icon: "fa-moon" },
    { name: "Waxing Crescent", icon: "fa-moon" },
    { name: "First Quarter", icon: "fa-moon" },
    { name: "Waxing Gibbous", icon: "fa-moon" },
    { name: "Full Moon", icon: "fa-moon" },
    { name: "Waning Gibbous", icon: "fa-moon" },
    { name: "Last Quarter", icon: "fa-moon" },
    { name: "Waning Crescent", icon: "fa-moon" },
  ];
  const phaseIndex = Math.floor(phaseFraction * 8) % 8;
  els.moonPhaseLabel.textContent = phases[phaseIndex].name;
}

function renderTips(data, conditionId) {
  const tips = [];
  const temp = data.main.temp;
  const isMetric = state.unit === "metric";
  const hot = isMetric ? temp >= 30 : temp >= 86;
  const cold = isMetric ? temp <= 10 : temp <= 50;

  if (conditionId >= 200 && conditionId < 300) tips.push({ icon: "fa-bolt", text: "Thunderstorms expected — stay indoors and avoid open areas." });
  if (conditionId >= 300 && conditionId < 600) tips.push({ icon: "fa-umbrella", text: "Rain likely — carry an umbrella or waterproof jacket." });
  if (conditionId >= 600 && conditionId < 700) tips.push({ icon: "fa-mitten", text: "Snowy conditions — dress in warm layers and watch for icy paths." });
  if (conditionId >= 700 && conditionId < 800) tips.push({ icon: "fa-smog", text: "Low visibility due to fog or haze — drive carefully." });
  if (hot) tips.push({ icon: "fa-sun", text: "High temperatures — stay hydrated and avoid prolonged sun exposure." });
  if (cold) tips.push({ icon: "fa-temperature-low", text: "Cold weather — wrap up warmly before heading out." });
  if (data.wind.speed > (isMetric ? 10 : 22)) tips.push({ icon: "fa-wind", text: "Strong winds — secure loose objects and travel cautiously." });
  if (tips.length === 0) tips.push({ icon: "fa-circle-check", text: "Pleasant conditions — a great day for outdoor plans." });
  tips.push({ icon: "fa-plane", text: data.main.temp > 15 && data.main.temp < 28 ? "Comfortable conditions for sightseeing and travel." : "Check destination weather closely before traveling today." });

  els.tipsList.innerHTML = tips.map((t) => `<li><i class="fa-solid ${t.icon}"></i>${t.text}</li>`).join("");
}

function renderTempChart(forecastData) {
  const next8 = forecastData.list.slice(0, 8);
  const labels = next8.map((item) => formatTime(item.dt, 0));
  const temps = next8.map((item) => Math.round(item.main.temp));

  if (state.chart) state.chart.destroy();
  state.chart = new Chart(els.tempChartCanvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: `Temperature (${unitSymbol()})`,
          data: temps,
          borderColor: "#06B6D4",
          backgroundColor: "rgba(59,130,246,0.18)",
          tension: 0.4,
          fill: true,
          pointBackgroundColor: "#8B5CF6",
          pointRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: "#CBD5E1" } } },
      scales: {
        x: { ticks: { color: "#94A3B8" }, grid: { color: "rgba(255,255,255,0.05)" } },
        y: { ticks: { color: "#94A3B8" }, grid: { color: "rgba(255,255,255,0.05)" } },
      },
    },
  });
}

/* =========================================================
   8. EVENT LISTENERS
   ========================================================= */

els.searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  fetchWeatherByCity(els.searchInput.value.trim());
});

els.locationBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    showError("Geolocation is not supported by your browser.");
    return;
  }
  setLoading(true);
  navigator.geolocation.getCurrentPosition(
    (pos) => fetchWeatherByCoords(pos.coords.latitude, pos.coords.longitude),
    () => {
      setLoading(false);
      showError("Location access denied. Search for a city instead.");
    }
  );
});

els.unitToggle.addEventListener("click", () => {
  state.unit = state.unit === "metric" ? "imperial" : "metric";
  localStorage.setItem("skyline_unit", state.unit);
  els.unitToggle.textContent = state.unit === "metric" ? "°C" : "°F";
  if (state.lastCoords) fetchWeatherByCoords(state.lastCoords.lat, state.lastCoords.lon);
});

els.themeToggle.addEventListener("click", () => {
  state.theme = state.theme === "dark" ? "light" : "dark";
  localStorage.setItem("skyline_theme", state.theme);
  applyTheme();
});

function applyTheme() {
  document.body.classList.toggle("light-mode", state.theme === "light");
  els.themeToggle.innerHTML =
    state.theme === "light" ? '<i class="fa-solid fa-sun"></i>' : '<i class="fa-solid fa-moon"></i>';
}

/** Voice search using the Web Speech API (if supported by the browser). */
els.voiceBtn.addEventListener("click", () => {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showError("Voice search is not supported in this browser.");
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = "en-US";
  recognition.onresult = (event) => {
    const city = event.results[0][0].transcript;
    els.searchInput.value = city;
    fetchWeatherByCity(city);
  };
  recognition.onerror = () => showError("Couldn't capture voice input. Try again.");
  recognition.start();
});

/** Press Enter to search is handled natively via form submit; explicit safeguard below. */
els.searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    fetchWeatherByCity(els.searchInput.value.trim());
  }
});

/* =========================================================
   9. AUTO REFRESH
   ========================================================= */

function restartAutoRefresh() {
  clearInterval(state.refreshTimer);
  state.refreshTimer = setInterval(() => {
    if (state.lastCoords) fetchWeatherByCoords(state.lastCoords.lat, state.lastCoords.lon);
  }, REFRESH_INTERVAL_MS);
}

/* =========================================================
   10. INITIALIZATION
   ========================================================= */

function init() {
  applyTheme();
  els.unitToggle.textContent = state.unit === "metric" ? "°C" : "°F";
  renderChips();

  // Try to restore the last viewed city from cache for instant offline-friendly UI.
  const cached = localStorage.getItem("skyline_last_city");
  if (cached) {
    try {
      const parsed = JSON.parse(cached);
      if (parsed?.current) {
        state.lastCoords = { lat: parsed.current.coord.lat, lon: parsed.current.coord.lon };
        renderCurrentWeather(parsed.current);
        if (parsed.forecast) {
          renderHourlyForecast(parsed.forecast, parsed.current.timezone);
          renderDailyForecast(parsed.forecast);
          renderTempChart(parsed.forecast);
        }
        if (parsed.aqi) renderAQI(parsed.aqi);
      }
    } catch (_) { /* ignore corrupted cache */ }
  }

  setLoading(false);

  // Auto-detect location on first load; falls back to a default city on failure.
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => fetchWeatherByCoords(pos.coords.latitude, pos.coords.longitude),
      () => fetchWeatherByCity("London")
    );
  } else {
    fetchWeatherByCity("London");
  }
}

document.addEventListener("DOMContentLoaded", init);
