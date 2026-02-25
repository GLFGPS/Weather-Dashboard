async function getWeather() {
    // Legacy static version (kept for reference only). Use server-side env vars in Next.js routes instead.
    const API_KEY = 'SET_IN_SERVER_ENV_NOT_CLIENT';
    const LOCATION = 'West Chester,PA';

    try {
        // Get current date and last year's date
        const now = new Date();
        const lastYear = new Date(now);
        lastYear.setFullYear(lastYear.getFullYear() - 1);
        
        // Format dates for API
        const startDate = lastYear.toISOString().split('T')[0];
        const endDate = now.toISOString().split('T')[0];

        // Fetch both current/forecast and historical data
        const [currentResponse, historicalResponse] = await Promise.all([
            fetch(
                `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${LOCATION}/${endDate}/${addDays(endDate, 3)}?unitGroup=us&include=current&key=${API_KEY}&contentType=json`
            ),
            fetch(
                `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${LOCATION}/${startDate}/${startDate}?unitGroup=us&include=current&key=${API_KEY}&contentType=json`
            )
        ]);

        if (!currentResponse.ok || !historicalResponse.ok) {
            throw new Error(`HTTP error! status: ${currentResponse.status} or ${historicalResponse.status}`);
        }

        const [currentData, historicalData] = await Promise.all([
            currentResponse.json(),
            historicalResponse.json()
        ]);

        // Update current conditions
        const currentConditions = currentData.currentConditions || currentData.days[0];
        const today = currentData.days[0];

        // Update temperatures
        document.getElementById('high-temp').textContent = `${Math.round(today.tempmax)}°F`;
        document.getElementById('low-temp').textContent = `${Math.round(today.tempmin)}°F`;
        document.getElementById('conditions').textContent = today.conditions;

        // Update precipitation
        document.getElementById('precipitation').textContent = `${Math.round(today.precipprob || 0)}%`;
        document.getElementById('precip-amount').textContent = `${today.precip || 0} in`;

        // Update wind
        document.getElementById('wind-speed').textContent = `${Math.round(currentConditions.windspeed)} mph`;
        document.getElementById('wind-dir').textContent = getWindDirection(currentConditions.winddir);

        // Update comfort metrics
        document.getElementById('feels-like').textContent = `${Math.round(currentConditions.feelslike)}°F`;
        document.getElementById('humidity').textContent = `${Math.round(currentConditions.humidity)}%`;

        // Update sun information
        document.getElementById('sunrise').textContent = formatTime(currentConditions.sunrise);
        document.getElementById('sunset').textContent = formatTime(currentConditions.sunset);
        document.getElementById('uv-index').textContent = currentConditions.uvindex;

        // Update historical data
        const historicalDay = historicalData.days[0];
        document.getElementById('hist-high').textContent = `${Math.round(historicalDay.tempmax)}°F`;
        document.getElementById('hist-low').textContent = `${Math.round(historicalDay.tempmin)}°F`;
        document.getElementById('hist-precip').textContent = `${historicalDay.precip || 0} in`;
        document.getElementById('hist-conditions').textContent = historicalDay.conditions;

        // Update historical high/low/humidity cards
        updateHistoricalCards(today, LOCATION, API_KEY);

        // Update forecast
        updateForecast(currentData.days.slice(1, 4));

        // Update last refresh time
        document.getElementById('update-time').textContent = 
            `Last updated: ${now.toLocaleTimeString()}`;

    } catch (error) {
        console.error('Error fetching weather data:', error);
        document.getElementById('conditions').textContent = 'Error loading weather data';
        document.getElementById('high-rank').textContent = 'Error';
        document.getElementById('low-rank').textContent = 'Error';
        document.getElementById('humidity-rank').textContent = 'Error';
    }
}

function updateForecast(forecastDays) {
    forecastDays.forEach((day, index) => {
        const cardNumber = index + 1;
        const card = document.getElementById(`forecast-${cardNumber}`);
        if (!card) return;

        // Update day title
        const dayDate = new Date(day.datetime);
        document.getElementById(`day-${cardNumber}`).textContent = 
            index === 0 ? 'Tomorrow' : dayDate.toLocaleDateString('en-US', { weekday: 'long' });

        // Update temperatures
        card.querySelector('.forecast-high-temp').textContent = `${Math.round(day.tempmax)}°F`;
        card.querySelector('.forecast-low-temp').textContent = `${Math.round(day.tempmin)}°F`;
        
        // Update precipitation
        card.querySelector('.forecast-precip-chance').textContent = `${Math.round(day.precipprob || 0)}%`;
        
        // Update conditions
        card.querySelector('.forecast-condition-text').textContent = day.conditions;
    });
}

function formatTime(timeStr) {
    if (!timeStr) return '--:--';
    const date = new Date(`2000-01-01T${timeStr}`);
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function getWindDirection(degrees) {
    if (degrees === undefined) return '--';
    
    const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                       'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round(((degrees %= 360) < 0 ? degrees + 360 : degrees) / 22.5) % 16;
    return directions[index];
}

function addDays(dateStr, days) {
    const date = new Date(dateStr);
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
}

async function updateHistoricalCards(today, location, apiKey) {
    const years = 5;
    const dateParts = today.datetime.split('-');
    const month = dateParts[1];
    const day = dateParts[2];
    const year = parseInt(dateParts[0], 10);
    const promises = [];
    for (let i = 1; i < years; i++) {
        const pastYear = year - i;
        const dateStr = `${pastYear}-${month}-${day}`;
        promises.push(
            fetch(`https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${location}/${dateStr}?unitGroup=us&key=${apiKey}&contentType=json`)
                .then(res => res.ok ? res.json() : null)
                .then(data => data && data.days && data.days[0] ? {
                    high: data.days[0].tempmax,
                    low: data.days[0].tempmin,
                    humidity: data.days[0].humidity
                } : null)
                .catch(() => null)
        );
    }
    // Show loading
    document.getElementById('high-rank').textContent = 'Loading...';
    document.getElementById('low-rank').textContent = 'Loading...';
    document.getElementById('humidity-rank').textContent = 'Loading...';
    let pastData;
    try {
        pastData = (await Promise.all(promises)).filter(x => x !== null);
    } catch (e) {
        document.getElementById('high-rank').textContent = 'Error';
        document.getElementById('low-rank').textContent = 'Error';
        document.getElementById('humidity-rank').textContent = 'Error';
        return;
    }
    if (pastData.length < 3) {
        document.getElementById('high-rank').textContent = 'Not enough data';
        document.getElementById('low-rank').textContent = 'Not enough data';
        document.getElementById('humidity-rank').textContent = 'Not enough data';
        return;
    }
    // Build arrays for each metric
    const highs = [today.tempmax, ...pastData.map(x => x.high)];
    const lows = [today.tempmin, ...pastData.map(x => x.low)];
    const humidities = [today.humidity, ...pastData.map(x => x.humidity)];
    // Calculate averages
    const avg = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    const avgHigh = avg(highs).toFixed(1);
    const avgLow = avg(lows).toFixed(1);
    const avgHumidity = avg(humidities).toFixed(1);
    // Calculate ranks
    const rank = (arr, val, desc = true) => {
        const sorted = [...arr].sort((a, b) => desc ? b - a : a - b);
        return sorted.indexOf(val) + 1;
    };
    const ordinal = i => {
        const j = i % 10, k = i % 100;
        if (j === 1 && k !== 11) return 'st';
        if (j === 2 && k !== 12) return 'nd';
        if (j === 3 && k !== 13) return 'rd';
        return 'th';
    };
    // Update High Card
    document.getElementById('high-today').textContent = `${Math.round(today.tempmax)}°F`;
    document.getElementById('high-avg').textContent = `${avgHigh}°F`;
    const highRank = rank(highs, today.tempmax, true);
    document.getElementById('high-rank').textContent = `Rank: ${highRank}${ordinal(highRank)} highest in 5 years`;
    // Update Low Card
    document.getElementById('low-today').textContent = `${Math.round(today.tempmin)}°F`;
    document.getElementById('low-avg').textContent = `${avgLow}°F`;
    const lowRank = rank(lows, today.tempmin, false);
    document.getElementById('low-rank').textContent = `Rank: ${lowRank}${ordinal(lowRank)} lowest in 5 years`;
    // Update Humidity Card
    document.getElementById('humidity-today').textContent = `${Math.round(today.humidity)}%`;
    document.getElementById('humidity-avg').textContent = `${avgHumidity}%`;
    const humidityRank = rank(humidities, today.humidity, true);
    document.getElementById('humidity-rank').textContent = `Rank: ${humidityRank}${ordinal(humidityRank)} highest in 5 years`;
}

// Fetch weather data when the page loads
document.addEventListener('DOMContentLoaded', getWeather);

// Refresh weather data every 30 minutes
setInterval(getWeather, 30 * 60 * 1000); 
