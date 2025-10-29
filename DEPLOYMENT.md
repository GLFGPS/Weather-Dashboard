# Vercel Deployment Guide

## Quick Start (5 minutes to deployment)

### Step 1: Push to GitHub
If you haven't already:
```bash
git add .
git commit -m "Ready for Vercel deployment"
git push origin main
```

### Step 2: Connect to Vercel

1. Go to [https://vercel.com/new](https://vercel.com/new)
2. Sign in with GitHub
3. Click "Import Project"
4. Select your repository from the list
5. Vercel will auto-detect Next.js

### Step 3: Configure Environment Variables

In the Vercel import screen, add these environment variables:

| Name | Value |
|------|-------|
| `NEXT_PUBLIC_WEATHER_API_KEY` | Your Visual Crossing API key |
| `NEXT_PUBLIC_LOCATION` | `West Chester,PA` |
| `NEXT_PUBLIC_LOCATION_LAT` | `39.9606` |
| `NEXT_PUBLIC_LOCATION_LON` | `-75.6055` |

### Step 4: Deploy

Click "Deploy" and wait ~2 minutes.

That's it! Your dashboard is live! 🚀

## Post-Deployment

### Your Live URL
Vercel will provide a URL like:
- Production: `https://your-project.vercel.app`
- Custom domain: You can add your own domain in Vercel settings

### Automatic Deployments
Every push to `main` will auto-deploy to production.

### Preview Deployments
Every pull request gets its own preview URL.

## Updating Environment Variables

1. Go to your project in Vercel dashboard
2. Click "Settings" → "Environment Variables"
3. Add/Edit variables
4. Redeploy for changes to take effect

## Monitoring

View in Vercel dashboard:
- **Analytics**: Page views, performance
- **Logs**: Server and function logs
- **Deployments**: History of all deployments

## Troubleshooting Deployment

### Build fails
- Check that all dependencies are in `package.json`
- Verify `npm run build` works locally
- Check Vercel build logs

### Environment variables not working
- Ensure they start with `NEXT_PUBLIC_` for client-side access
- Redeploy after adding variables
- Check variable names match exactly

### API rate limits
- Visual Crossing free tier: 1,000 records/day
- For heavy usage, upgrade Visual Crossing plan
- Cache weather data to reduce API calls

## Performance Optimization

Vercel handles automatically:
- ✅ Global CDN
- ✅ Automatic HTTPS
- ✅ Image optimization
- ✅ Edge caching
- ✅ Compression

## Cost

### Vercel
- **Hobby Plan**: FREE
  - Unlimited deployments
  - 100GB bandwidth/month
  - Perfect for this dashboard

### Visual Crossing Weather API
- **Free Tier**: 1,000 records/day
- **Paid Plans**: Start at $0.0001/record

For 5 years of daily data (~1,825 days), you'll need about 2 days on the free tier or upgrade to a paid plan.

## Security

Your API key is:
- ✅ Stored securely in Vercel environment variables
- ✅ Never exposed in git repository
- ✅ Encrypted in transit

## Next Steps

1. **Test your deployment**: Upload sample lead data
2. **Add custom domain** (optional): Vercel Settings → Domains
3. **Set up notifications**: Vercel can notify you of deployments
4. **Monitor usage**: Check Visual Crossing API usage

## Need Help?

- Vercel Docs: https://vercel.com/docs
- Visual Crossing Support: https://www.visualcrossing.com/weather-api
- Next.js Docs: https://nextjs.org/docs
