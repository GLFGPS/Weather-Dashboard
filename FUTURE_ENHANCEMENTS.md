# Future Enhancement Architecture

This document outlines how to add planned features to the weather dashboard.

## 1. HubSpot Integration

### Architecture Overview
The dashboard is already structured to support HubSpot integration with minimal changes.

### Implementation Steps

1. **Install HubSpot SDK**
```bash
npm install @hubspot/api-client
```

2. **Create HubSpot Service** (`lib/hubspotService.ts`)
```typescript
import { Client } from "@hubspot/api-client";

export class HubSpotService {
  private client: Client;

  constructor(apiKey: string) {
    this.client = new Client({ apiKey });
  }

  async fetchDeals(startDate: string, endDate: string) {
    // Fetch deals created in date range
    const response = await this.client.crm.deals.searchApi.doSearch({
      filterGroups: [{
        filters: [{
          propertyName: "createdate",
          operator: "BETWEEN",
          value: startDate,
          highValue: endDate
        }]
      }]
    });
    
    return this.transformToLeadData(response.results);
  }

  private transformToLeadData(deals: any[]) {
    // Convert HubSpot deals to LeadData format
    return deals.map(deal => ({
      date: deal.properties.createdate,
      leads: 1, // Or aggregate by day
      source: deal.properties.source,
      cost: parseFloat(deal.properties.cost || 0),
      conversions: deal.properties.dealstage === 'closed_won' ? 1 : 0
    }));
  }
}
```

3. **Add HubSpot Upload Button** (modify `app/page.tsx`)
```typescript
const handleHubSpotSync = async () => {
  const hubspot = new HubSpotService(process.env.NEXT_PUBLIC_HUBSPOT_API_KEY);
  const deals = await hubspot.fetchDeals(leadData.startDate, leadData.endDate);
  // Process like CSV upload
  handleLeadDataUpload(deals);
};
```

4. **Environment Variables**
```env
NEXT_PUBLIC_HUBSPOT_API_KEY=your_hubspot_key
```

### No Breaking Changes
- Existing CSV upload continues to work
- `DataProcessingService` handles both sources
- UI just adds a "Sync from HubSpot" button

---

## 2. Soil Temperature Data

### Potential Data Sources

#### Option A: NOAA/USDA API
```typescript
export class SoilTemperatureService {
  static async getSoilTemp(lat: number, lon: number, date: string) {
    // NOAA or USDA API calls
    const response = await fetch(
      `https://api.weather.gov/points/${lat},${lon}/stations/observations`
    );
    // Extract soil temperature if available
  }
}
```

#### Option B: OpenWeatherMap Soil API (if available)
```typescript
const soilData = await fetch(
  `https://api.openweathermap.org/data/2.5/onecall?lat=${lat}&lon=${lon}&appid=${key}`
);
```

#### Option C: Agricultural APIs
- Arable API
- FarmLogs API
- Climate FieldView

### Integration Steps

1. **Update Types** (`types/index.ts`)
```typescript
export interface WeatherLeadData {
  // ... existing fields
  soilTemp?: number; // Add optional field
  soilMoisture?: number;
}
```

2. **Update Correlation Analysis**
```typescript
const metrics = [
  // ... existing metrics
  'soilTemp',
  'soilMoisture'
];
```

3. **Add to Dashboard Charts**
- New time series chart for soil temp vs leads
- Add to correlation matrix

### No Breaking Changes
- Soil temp is optional
- Existing functionality unchanged
- New visualizations only appear when data available

---

## 3. Google Ads API Integration

### Setup

1. **Install Google Ads API Client**
```bash
npm install google-ads-api
```

2. **Create Google Ads Service** (`lib/googleAdsService.ts`)
```typescript
import { GoogleAdsApi } from 'google-ads-api';

export class GoogleAdsService {
  private client: GoogleAdsApi;

  constructor(clientId: string, clientSecret: string, refreshToken: string) {
    this.client = new GoogleAdsApi({
      client_id: clientId,
      client_secret: clientSecret,
      developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
    });
  }

  async getSearchVolumeData(startDate: string, endDate: string) {
    const customer = this.client.Customer({
      customer_id: process.env.GOOGLE_ADS_CUSTOMER_ID,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
    });

    const query = `
      SELECT 
        segments.date,
        metrics.impressions,
        metrics.clicks,
        metrics.cost_micros
      FROM campaign
      WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'
      AND campaign.name LIKE '%pest control%'
    `;

    const results = await customer.query(query);
    return this.transformToTrendsData(results);
  }
}
```

3. **Replace Google Trends Widget**
- Currently uses embedded Google Trends
- Replace with real-time Google Ads search volume
- More accurate, account-specific data

### OAuth Setup
```typescript
// Add OAuth flow for Google Ads
// Store refresh token securely in environment variables
```

---

## 4. Predictive Modeling (ML)

### Simple Linear Regression

```typescript
export class PredictiveService {
  static predictLeads(
    temperature: number,
    humidity: number,
    historicalData: WeatherLeadData[]
  ): number {
    // Use correlation coefficients to predict leads
    const tempCorr = findCorrelation(historicalData, 'tempAvg', 'leads');
    const humidityCorr = findCorrelation(historicalData, 'humidity', 'leads');
    
    // Simple weighted prediction
    const avgLeads = mean(historicalData.map(d => d.leads));
    const tempImpact = tempCorr * (temperature - mean(historicalData.map(d => d.tempAvg)));
    const humidityImpact = humidityCorr * (humidity - mean(historicalData.map(d => d.humidity)));
    
    return avgLeads + tempImpact + humidityImpact;
  }
}
```

### Advanced: TensorFlow.js

```typescript
import * as tf from '@tensorflow/tfjs';

export class MLPredictiveService {
  static async trainModel(data: WeatherLeadData[]) {
    // Features: temp, humidity, precipitation, UV, etc.
    const features = data.map(d => [
      d.tempAvg,
      d.humidity,
      d.precipitation,
      d.uvIndex,
      d.windSpeed
    ]);
    
    // Labels: leads
    const labels = data.map(d => d.leads);
    
    const model = tf.sequential({
      layers: [
        tf.layers.dense({ units: 10, activation: 'relu', inputShape: [5] }),
        tf.layers.dense({ units: 5, activation: 'relu' }),
        tf.layers.dense({ units: 1 })
      ]
    });
    
    model.compile({ optimizer: 'adam', loss: 'meanSquaredError' });
    
    await model.fit(
      tf.tensor2d(features),
      tf.tensor1d(labels),
      { epochs: 100 }
    );
    
    return model;
  }
  
  static predict(model: tf.Sequential, weather: number[]) {
    return model.predict(tf.tensor2d([weather]));
  }
}
```

---

## 5. Email/Slack Alerts

### Daily Insights Email

```typescript
import nodemailer from 'nodemailer';

export class AlertService {
  static async sendDailyInsights(
    email: string,
    forecast: WeatherDay[],
    predictedLeads: number
  ) {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
      }
    });

    await transporter.sendMail({
      to: email,
      subject: 'Daily Lead Forecast',
      html: `
        <h1>Today's Forecast</h1>
        <p>Temperature: ${forecast[0].tempmax}°F</p>
        <p>Predicted Leads: ${Math.round(predictedLeads)}</p>
        <p>Recommendation: ${getRecommendation(predictedLeads)}</p>
      `
    });
  }
}
```

### Vercel Cron Jobs
```typescript
// api/cron/daily-insights.ts
export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }
  
  // Run daily insights
  await AlertService.sendDailyInsights(/* ... */);
  
  res.status(200).json({ success: true });
}
```

Configure in `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/cron/daily-insights",
    "schedule": "0 8 * * *"
  }]
}
```

---

## 6. Multi-Location Support

### Database Schema

```typescript
interface Location {
  id: string;
  name: string;
  lat: number;
  lon: number;
  leadData: LeadDataset;
}

// Store in database (Vercel Postgres, MongoDB, etc.)
```

### UI Changes

```typescript
// Add location selector
const [selectedLocation, setSelectedLocation] = useState<Location>();

// Fetch weather for selected location
useEffect(() => {
  if (selectedLocation) {
    fetchWeatherForLocation(selectedLocation);
  }
}, [selectedLocation]);
```

---

## 7. Export to PDF

```typescript
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

export class ExportService {
  static async exportDashboard() {
    const pdf = new jsPDF('p', 'mm', 'a4');
    const elements = document.querySelectorAll('.export-section');
    
    for (let i = 0; i < elements.length; i++) {
      const canvas = await html2canvas(elements[i]);
      const imgData = canvas.toDataURL('image/png');
      
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, 'PNG', 10, 10, 190, 0);
    }
    
    pdf.save('weather-dashboard.pdf');
  }
}
```

---

## Implementation Priority

### Phase 1 (Immediate)
1. ✅ CSV Upload (Done)
2. ✅ Basic Correlation Analysis (Done)
3. ✅ Time Series Charts (Done)

### Phase 2 (Next 2 weeks)
1. HubSpot Integration
2. Google Ads API
3. Email Alerts

### Phase 3 (1-2 months)
1. Soil Temperature Data
2. Predictive Modeling
3. Multi-location Support

### Phase 4 (Future)
1. Mobile App
2. Advanced ML Models
3. Real-time Dashboard Updates

---

## Notes

- All enhancements maintain backward compatibility
- Existing CSV upload always works
- New features are additive, not breaking changes
- Architecture supports easy plugin system
