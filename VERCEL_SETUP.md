# ✅ Vercel Deployment Checklist

## Before You Deploy

- [x] ✅ Next.js app built successfully
- [x] ✅ All dependencies installed
- [x] ✅ TypeScript compilation passes
- [x] ✅ Environment variables configured locally
- [x] ✅ Git repository initialized

## Deploy to Vercel - Step by Step

### 1. Commit and Push to GitHub

```bash
# Make sure all files are committed
git add .
git commit -m "Weather dashboard ready for deployment"
git push origin main
```

### 2. Sign Up / Login to Vercel

Go to: **https://vercel.com/signup**

- Sign in with your GitHub account
- Authorize Vercel to access your repositories

### 3. Import Your Project

1. Click **"Add New Project"** or **"Import Project"**
2. Select your repository from the list
3. Vercel will automatically detect it's a Next.js project

### 4. Configure Your Project

**Framework Preset:** Next.js (auto-detected)

**Root Directory:** `./` (leave as default)

**Build Command:** `npm run build` (default)

**Output Directory:** `.next` (default)

### 5. Add Environment Variables

Click **"Environment Variables"** and add these:

| Variable Name | Value | All Environments |
|---------------|-------|------------------|
| `NEXT_PUBLIC_WEATHER_API_KEY` | `KBC5EJCQGFX2NUR779XBYG332` | ✓ |
| `NEXT_PUBLIC_LOCATION` | `West Chester,PA` | ✓ |
| `NEXT_PUBLIC_LOCATION_LAT` | `39.9606` | ✓ |
| `NEXT_PUBLIC_LOCATION_LON` | `-75.6055` | ✓ |

**IMPORTANT:** Make sure "All Environments" is checked for each variable!

### 6. Deploy!

Click **"Deploy"**

⏱️ Deployment takes ~2-3 minutes

### 7. Your Dashboard is LIVE! 🎉

Vercel will provide you with:
- **Production URL:** `https://your-project.vercel.app`
- **Preview URLs:** For every pull request
- **Analytics Dashboard:** View traffic and performance

## After Deployment

### Test Your Dashboard

1. Visit your Vercel URL
2. Check that current weather loads
3. Upload the sample CSV: `sample-data/sample-leads.csv`
4. Verify correlation analysis runs
5. Check all charts render properly

### Custom Domain (Optional)

1. Go to your project in Vercel
2. Click **Settings** → **Domains**
3. Add your custom domain
4. Follow DNS configuration instructions

### Monitor Your Dashboard

**Vercel Dashboard:** https://vercel.com/dashboard
- View deployments
- Check analytics
- Monitor errors
- View build logs

### Automatic Deployments

Every time you push to `main`:
- Vercel automatically builds and deploys
- Zero downtime deployment
- Rollback available if needed

## Troubleshooting

### Build Fails
1. Check build logs in Vercel dashboard
2. Verify environment variables are set
3. Test `npm run build` locally first

### Weather Data Not Loading
1. Verify API key is correct in Vercel environment variables
2. Check Visual Crossing API usage limits
3. Check browser console for errors

### Charts Not Rendering
1. Upload lead data CSV file
2. Ensure CSV has correct format (date, leads columns)
3. Check that dates are valid

## API Usage & Costs

### Vercel
- **FREE** on Hobby plan
- Unlimited deployments
- 100GB bandwidth/month
- Perfect for this dashboard

### Visual Crossing Weather API
- Current key has limited quota
- Monitor usage at: https://www.visualcrossing.com/account
- For heavy usage (5+ years data), consider upgrading

## Next Steps

1. ✅ Deploy to Vercel
2. ✅ Test with sample data
3. ✅ Upload your actual lead data
4. ✅ Share the URL with your team
5. ✅ Set up custom domain (optional)
6. ✅ Monitor API usage

## Support

- Vercel Docs: https://vercel.com/docs
- Next.js Docs: https://nextjs.org/docs
- Weather API: https://www.visualcrossing.com/weather-api

---

**Ready to deploy?** Follow the steps above and your dashboard will be live in minutes! 🚀
