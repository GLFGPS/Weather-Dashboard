async function getWeather() {
    const API_KEY = 'KBC5EJCQGFX2NUR779XBYG332';
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

        // Update historical rank
        getHistoricalRank(today.tempmax, today.tempmin, today.datetime, LOCATION, API_KEY);

        // Update forecast
        updateForecast(currentData.days.slice(1, 4));

        // Update last refresh time
        document.getElementById('update-time').textContent = 
            `Last updated: ${now.toLocaleTimeString()}`;

    } catch (error) {
        console.error('Error fetching weather data:', error);
        document.getElementById('conditions').textContent = 'Error loading weather data';
        document.getElementById('historical-rank').textContent = 'Error loading historical rank';
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

async function getHistoricalRank(todayHigh, todayLow, todayDate, location, apiKey) {
    const years = 10;
    const dateParts = todayDate.split('-');
    const month = dateParts[1];
    const day = dateParts[2];
    const year = parseInt(dateParts[0], 10);
    const promises = [];
    document.getElementById('historical-rank').textContent = 'Loading...';
    for (let i = 1; i < years; i++) {
        const pastYear = year - i;
        const dateStr = `${pastYear}-${month}-${day}`;
        promises.push(
            fetch(`https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${location}/${dateStr}?unitGroup=us&key=${apiKey}&contentType=json`)
                .then(res => res.ok ? res.json() : null)
                .then(data => data && data.days && data.days[0] ? {
                    high: data.days[0].tempmax,
                    low: data.days[0].tempmin
                } : null)
                .catch(() => null)
        );
    }
    let pastTemps;
    try {
        pastTemps = (await Promise.all(promises)).filter(x => x !== null);
    } catch (e) {
        document.getElementById('historical-rank').textContent = 'Error loading historical data.';
        return;
    }
    if (pastTemps.length < 5) {
        document.getElementById('historical-rank').textContent = 'Not enough historical data available.';
        return;
    }
    const allHighs = [todayHigh, ...pastTemps.map(x => x.high)];
    const allLows = [todayLow, ...pastTemps.map(x => x.low)];
    // Hottest rank (high temp, descending)
    const sortedHighs = [...allHighs].sort((a, b) => b - a);
    const hotRank = sortedHighs.indexOf(todayHigh) + 1;
    // Coldest rank (low temp, ascending)
    const sortedLows = [...allLows].sort((a, b) => a - b);
    const coldRank = sortedLows.indexOf(todayLow) + 1;
    // Build text
    let hotText = '';
    if (hotRank === 1) {
        hotText = `hottest`;
    } else if (hotRank === allHighs.length) {
        hotText = `coldest (high)`;
    } else {
        hotText = `${hotRank}${ordinalSuffix(hotRank)} hottest`;
    }
    let coldText = '';
    if (coldRank === 1) {
        coldText = `coldest`;
    } else if (coldRank === allLows.length) {
        coldText = `warmest (low)`;
    } else {
        coldText = `${coldRank}${ordinalSuffix(coldRank)} coldest`;
    }
    let rankText = `Today is the ${hotText} and ${coldText} day in the last ${allHighs.length} years.`;
    document.getElementById('historical-rank').textContent = rankText;
}

function ordinalSuffix(i) {
    const j = i % 10, k = i % 100;
    if (j === 1 && k !== 11) return 'st';
    if (j === 2 && k !== 12) return 'nd';
    if (j === 3 && k !== 13) return 'rd';
    return 'th';
}

// Fetch weather data when the page loads
document.addEventListener('DOMContentLoaded', getWeather);

// Refresh weather data every 30 minutes
setInterval(getWeather, 30 * 60 * 1000); 
