// Analytics Helper Functions

export class AnalyticsService {
  constructor() {
    this.data = [];
  }

  // Calculate engagement rate
  calculateEngagementRate(likes, comments, followers) {
    if (followers === 0) return 0;
    return ((likes + comments) / followers) * 100;
  }

  // Calculate growth rate
  calculateGrowthRate(current, previous) {
    if (previous === 0) return 0;
    return ((current - previous) / previous) * 100;
  }

  // Get best time to post based on historical data
  getBestTimeToPost(analyticsData) {
    const hourlyEngagement = {};

    analyticsData.forEach(data => {
      const hour = new Date(data.timestamp).getHours();
      if (!hourlyEngagement[hour]) {
        hourlyEngagement[hour] = { total: 0, count: 0 };
      }
      hourlyEngagement[hour].total += data.engagement || 0;
      hourlyEngagement[hour].count += 1;
    });

    let bestHour = 0;
    let maxAvgEngagement = 0;

    Object.keys(hourlyEngagement).forEach(hour => {
      const avg = hourlyEngagement[hour].total / hourlyEngagement[hour].count;
      if (avg > maxAvgEngagement) {
        maxAvgEngagement = avg;
        bestHour = parseInt(hour);
      }
    });

    return {
      hour: bestHour,
      timeRange: `${bestHour}:00 - ${bestHour + 1}:00`,
      avgEngagement: maxAvgEngagement.toFixed(2)
    };
  }

  // Calculate follower growth trend
  getFollowerTrend(analyticsData) {
    if (analyticsData.length < 2) return 'stable';

    const recent = analyticsData.slice(-7); // Last 7 days
    const growthRates = [];

    for (let i = 1; i < recent.length; i++) {
      const rate = this.calculateGrowthRate(
        recent[i].followers,
        recent[i - 1].followers
      );
      growthRates.push(rate);
    }

    const avgGrowth = growthRates.reduce((a, b) => a + b, 0) / growthRates.length;

    if (avgGrowth > 1) return 'growing';
    if (avgGrowth < -1) return 'declining';
    return 'stable';
  }

  // Generate daily report
  generateDailyReport(stats) {
    return {
      date: new Date().toISOString().split('T')[0],
      likes: stats.dailyLikes || 0,
      comments: stats.dailyComments || 0,
      follows: stats.dailyFollows || 0,
      unfollows: stats.dailyUnfollows || 0,
      stories: stats.dailyStories || 0,
      engagement: stats.engagement || 0,
      netFollowers: (stats.dailyFollows || 0) - (stats.dailyUnfollows || 0)
    };
  }

  // Calculate competitor metrics
  analyzeCompetitor(competitorData) {
    return {
      avgLikes: competitorData.reduce((sum, post) => sum + post.likes, 0) / competitorData.length,
      avgComments: competitorData.reduce((sum, post) => sum + post.comments, 0) / competitorData.length,
      postFrequency: this.calculatePostFrequency(competitorData),
      topHashtags: this.getTopHashtags(competitorData),
      engagementRate: this.calculateEngagementRate(
        competitorData.reduce((sum, post) => sum + post.likes, 0),
        competitorData.reduce((sum, post) => sum + post.comments, 0),
        competitorData[0]?.followers || 1
      )
    };
  }

  calculatePostFrequency(posts) {
    if (posts.length < 2) return 0;

    const timestamps = posts.map(p => new Date(p.timestamp).getTime());
    timestamps.sort((a, b) => a - b);

    const intervals = [];
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }

    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    return Math.round(avgInterval / (1000 * 60 * 60 * 24)); // Days
  }

  getTopHashtags(posts) {
    const hashtagCount = {};

    posts.forEach(post => {
      if (post.hashtags) {
        post.hashtags.forEach(tag => {
          hashtagCount[tag] = (hashtagCount[tag] || 0) + 1;
        });
      }
    });

    return Object.entries(hashtagCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([tag, count]) => ({ tag, count }));
  }

  // Export data to CSV
  exportToCSV(data, filename = 'instagram_analytics.csv') {
    const headers = Object.keys(data[0]).join(',');
    const rows = data.map(row => Object.values(row).join(','));
    const csv = [headers, ...rows].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  }
}

export default AnalyticsService;
