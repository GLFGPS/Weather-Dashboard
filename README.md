# Pest Control Weather Dashboard

A comprehensive weather analytics dashboard that correlates weather patterns with pest control lead generation. Built with Next.js, TypeScript, and deployed on Vercel.

## Features

### 📊 Live Weather Data
- Real-time weather conditions for West Chester, PA
- Temperature, humidity, precipitation, UV index, wind, and more
- 7-day forecast
- Visual Crossing Weather API integration

### 📈 Lead Data Analytics
- CSV/Excel upload for historical lead data
- 5 years of historical weather data analysis
- Automatic correlation analysis between weather factors and leads

### 🔬 Advanced Correlation Analysis
- **Pearson correlation coefficients** with statistical significance testing
- **Correlation heatmap** showing all weather-to-weather and weather-to-lead relationships
- **Top insights** highlighting which weather factors most strongly impact leads
- Optimal temperature range analysis for lead generation

### 📉 Data Visualizations
- Time series charts overlaying leads with:
  - Temperature
  - Humidity
  - Precipitation
  - UV Index
- Seasonal breakdown analysis
- Monthly aggregated statistics
- Google Trends integration for "pest control" and "exterminator" search volume

### 🧪 Statistical Methods
- Moving averages for trend analysis
- Seasonal decomposition
- P-value calculations for statistical significance
- Temperature bucketing for pattern discovery

## Architecture

### Built for Vercel Deployment
- **Next.js 15** with App Router
- **TypeScript** for type safety
- **Tailwind CSS** for styling
- **Recharts** for data visualization
- **Papa Parse** for CSV parsing
- **XLSX** for Excel file support

### Future-Ready
- Architected to easily add:
  - HubSpot CRM integration
  - Soil temperature data when available
  - Google Ads API integration
  - Additional weather metrics

## Setup & Deployment

### Prerequisites
- Node.js 18+ installed
- Visual Crossing Weather API key ([Get one free](https://www.visualcrossing.com/))
- Vercel account ([Sign up free](https://vercel.com/signup))

### Local Development

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd weather-dashboard
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```

   Edit `.env.local` and add your API key:
   ```env
   NEXT_PUBLIC_WEATHER_API_KEY=your_actual_api_key_here
   NEXT_PUBLIC_LOCATION=West Chester,PA
   NEXT_PUBLIC_LOCATION_LAT=39.9606
   NEXT_PUBLIC_LOCATION_LON=-75.6055
   ```

4. **Run the development server**
   ```bash
   npm run dev
   ```

5. **Open in browser**
   
   Navigate to [http://localhost:3000](http://localhost:3000)

### Deploy to Vercel

#### Option 1: Deploy via Vercel Dashboard (Recommended for first deployment)

1. **Push your code to GitHub**
   ```bash
   git add .
   git commit -m "Initial commit"
   git push origin main
   ```

2. **Go to [Vercel Dashboard](https://vercel.com/dashboard)**

3. **Click "Add New Project"**

4. **Import your GitHub repository**

5. **Configure the project**
   - Framework Preset: **Next.js** (auto-detected)
   - Root Directory: `./`
   - Build Command: `npm run build` (default)
   - Output Directory: `.next` (default)

6. **Add Environment Variables**
   
   In the Vercel project settings, add these environment variables:
   - `NEXT_PUBLIC_WEATHER_API_KEY` = your Visual Crossing API key
   - `NEXT_PUBLIC_LOCATION` = West Chester,PA
   - `NEXT_PUBLIC_LOCATION_LAT` = 39.9606
   - `NEXT_PUBLIC_LOCATION_LON` = -75.6055

7. **Click "Deploy"**

8. **Your dashboard is live!** 🎉
   
   Vercel will provide you with a URL like: `https://your-project.vercel.app`

#### Option 2: Deploy via Vercel CLI

1. **Install Vercel CLI**
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel**
   ```bash
   vercel login
   ```

3. **Deploy**
   ```bash
   vercel
   ```

4. **Add environment variables**
   ```bash
   vercel env add NEXT_PUBLIC_WEATHER_API_KEY
   vercel env add NEXT_PUBLIC_LOCATION
   ```

5. **Deploy to production**
   ```bash
   vercel --prod
   ```

### Continuous Deployment

Once connected to Vercel:
- Every push to `main` branch automatically deploys to production
- Pull requests create preview deployments
- Vercel handles build optimization and CDN distribution automatically

## Usage

### Uploading Lead Data

1. **Prepare your CSV/Excel file** with these columns:
   - `date` (required) - Format: YYYY-MM-DD or MM/DD/YYYY
   - `leads` (required) - Number of leads
   - `source` (optional) - Lead source
   - `campaign` (optional) - Campaign name
   - `cost` (optional) - Advertising cost
   - `conversions` (optional) - Number of conversions

   Example CSV:
   ```csv
   date,leads,source,cost,conversions
   2024-01-15,42,Google Ads,250.00,5
   2024-01-16,38,Facebook,180.00,3
   2024-01-17,51,Organic,0,7
   ```

2. **Upload the file** using the upload button in the dashboard

3. **Wait for processing** - The dashboard will:
   - Parse your lead data
   - Fetch 5 years of historical weather data for matching dates
   - Calculate correlations
   - Generate visualizations

4. **Explore insights** - Scroll through:
   - Top correlations
   - Time series charts
   - Seasonal analysis
   - Optimal temperature ranges

## Understanding the Analytics

### Correlation Coefficients
- **+1.0**: Perfect positive correlation (both increase together)
- **+0.7 to +1.0**: Strong positive correlation
- **+0.4 to +0.7**: Moderate positive correlation
- **+0.2 to +0.4**: Weak positive correlation
- **0 to ±0.2**: Very weak/no correlation
- **-0.2 to -0.4**: Weak negative correlation
- **-0.4 to -0.7**: Moderate negative correlation
- **-0.7 to -1.0**: Strong negative correlation
- **-1.0**: Perfect negative correlation (one increases, other decreases)

### Statistical Significance
- **p < 0.05**: Statistically significant (unlikely to be random chance)
- **p ≥ 0.05**: Not statistically significant

### Pest Control Insights
The dashboard analyzes these weather factors for pest activity:
- **Temperature**: Most insects become active 50-95°F
- **Humidity**: High humidity often increases pest pressure
- **Precipitation**: Can drive pests indoors
- **UV Index**: Affects outdoor pest behavior
- **Barometric Pressure**: Can influence pest movement
- **Wind Speed**: Affects flying insect activity

## API Rate Limits

Visual Crossing free tier:
- 1,000 records/day
- For 5 years of data (~1,825 days), you may need a paid plan or break uploads into smaller chunks

## Troubleshooting

### "Failed to fetch weather data"
- Check that your API key is correctly set in Vercel environment variables
- Verify the API key is valid at Visual Crossing
- Check Visual Crossing API usage limits

### "CSV parsing errors"
- Ensure your CSV has headers: date, leads
- Check date format (YYYY-MM-DD or MM/DD/YYYY)
- Remove any special characters or extra spaces

### Data takes too long to load
- Large datasets (5+ years daily) may take 30-60 seconds
- Consider aggregating to weekly data for faster processing
- Visual Crossing API has rate limits

### Charts not displaying
- Ensure you have both weather and lead data
- Check browser console for errors
- Try refreshing the page

## Environment Variables Reference

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_WEATHER_API_KEY` | Visual Crossing API key | `ABC123XYZ789` |
| `NEXT_PUBLIC_LOCATION` | Location for weather data | `West Chester,PA` |
| `NEXT_PUBLIC_LOCATION_LAT` | Latitude (optional) | `39.9606` |
| `NEXT_PUBLIC_LOCATION_LON` | Longitude (optional) | `-75.6055` |

## Tech Stack

- **Framework**: Next.js 15 (React 18)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Charts**: Recharts
- **Data Processing**: Papa Parse, XLSX
- **Weather API**: Visual Crossing
- **Hosting**: Vercel
- **Version Control**: Git

## Future Enhancements

### Planned Features
- [ ] HubSpot CRM integration for automatic lead syncing
- [ ] Soil temperature data integration
- [ ] Google Ads API for real-time search volume
- [ ] Predictive modeling (ML-based lead forecasting)
- [ ] Email reports for key insights
- [ ] Custom date range selection
- [ ] Export correlation reports to PDF
- [ ] Multi-location support
- [ ] Mobile app version

### Easy to Add
The codebase is architected to easily integrate:
- New weather data sources
- Additional CRM systems
- More correlation metrics
- Custom alert systems

## Contributing

This is a private project, but suggestions are welcome!

## License

Proprietary - All rights reserved

## Support

For issues or questions, contact: [your-email@example.com]

---

**Built with ❤️ for data-driven pest control marketing**
