'use client';

import { useEffect } from 'react';

export default function GoogleTrends() {
  useEffect(() => {
    // Load Google Trends embed script
    const script = document.createElement('script');
    script.src = 'https://ssl.gstatic.com/trends_nrtr/4031_RC01/embed_loader.js';
    script.async = true;
    document.body.appendChild(script);

    script.onload = () => {
      // @ts-ignore - Google Trends global
      if (window.trends) {
        // @ts-ignore
        window.trends.embed.renderExploreWidget('TIMESERIES', {
          comparisonItem: [
            { keyword: 'pest control', geo: 'US-PA-504', time: 'today 5-y' },
            { keyword: 'exterminator', geo: 'US-PA-504', time: 'today 5-y' }
          ],
          category: 0,
          property: ''
        }, {
          exploreQuery: 'date=today%205-y&geo=US-PA-504&q=pest%20control,exterminator&hl=en',
          guestPath: 'https://trends.google.com:443/trends/embed/'
        });
      }
    };

    return () => {
      document.body.removeChild(script);
    };
  }, []);

  return (
    <div>
      <div id="trends-widget" style={{ minHeight: '400px' }}>
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-500">Loading Google Trends data...</div>
        </div>
      </div>
    </div>
  );
}
