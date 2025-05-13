async function getWeather() {
    const API_KEY = 'KBC5EJCQGFX2NUR779XBYG332';
    const LOCATION = 'West Chester,PA';

    try {
        const response = await fetch(
            `https://weather.visualcrossing.com/VisualCrossingWebServices/rest/services/timeline/${LOCATION}/today?unitGroup=us&include=current&key=${API_KEY}&contentType=json`
        );
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();

        // Get the current conditions
        const currentConditions = data.currentConditions || data.days[0];
        const today = data.days[0];

        // Update temperatures
        const highTemp = Math.round(today.tempmax);
        const lowTemp = Math.round(today.tempmin);
        const precipitation = Math.round(today.precipprob || 0);

        // Update the DOM
        document.getElementById('high-temp').textContent = `${highTemp}°F`;
        document.getElementById('low-temp').textContent = `${lowTemp}°F`;
        document.getElementById('precipitation').textContent = `${precipitation}%`;
        document.getElementById('conditions').textContent = today.conditions;

        // Update last refresh time
        const now = new Date();
        document.getElementById('update-time').textContent = 
            `Last updated: ${now.toLocaleTimeString()}`;

    } catch (error) {
        console.error('Error fetching weather data:', error);
        document.getElementById('conditions').textContent = 'Error loading weather data';
    }
}

// Fetch weather data when the page loads
document.addEventListener('DOMContentLoaded', getWeather);

// Refresh weather data every 30 minutes
setInterval(getWeather, 30 * 60 * 1000); 