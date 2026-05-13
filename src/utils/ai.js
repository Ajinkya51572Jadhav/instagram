// AI Helper Functions for Instagram Pro

export class AIService {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.baseURL = 'https://api.openai.com/v1';
  }

  // Generate AI comment based on post content
  async generateComment(postData) {
    if (!this.apiKey) {
      return this.getFallbackComment(postData);
    }

    try {
      const prompt = this.buildCommentPrompt(postData);
      
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: 'You are a friendly Instagram user. Generate short, genuine comments (max 10 words) with emojis. Be positive and engaging.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          max_tokens: 50,
          temperature: 0.8
        })
      });

      const data = await response.json();
      return data.choices[0].message.content.trim();
    } catch (error) {
      console.error('AI comment generation failed:', error);
      return this.getFallbackComment(postData);
    }
  }

  buildCommentPrompt(postData) {
    const { caption, isVideo, hashtags } = postData;
    
    let prompt = 'Generate a short Instagram comment for this post:\n';
    if (caption) prompt += `Caption: ${caption.substring(0, 100)}\n`;
    if (isVideo) prompt += 'Type: Video\n';
    if (hashtags) prompt += `Hashtags: ${hashtags.join(', ')}\n`;
    
    return prompt;
  }

  getFallbackComment(postData) {
    const { isVideo } = postData;
    
    const comments = isVideo ? [
      'Great video! 🎥',
      'Love this! 🔥',
      'Amazing content! 👏',
      'Well done! 💯',
      'Keep it up! 🙌'
    ] : [
      'Beautiful! ✨',
      'Love this! ❤️',
      'Amazing! 🔥',
      'Great shot! 📸',
      'Stunning! 😍'
    ];

    return comments[Math.floor(Math.random() * comments.length)];
  }

  // Analyze post quality (0-1 score)
  async analyzePostQuality(postData) {
    const { likes, comments, followers, caption } = postData;
    
    // Calculate engagement rate
    const engagementRate = followers > 0 
      ? ((likes + comments) / followers) * 100 
      : 0;

    // Quality factors
    let score = 0;
    
    // Engagement rate (40% weight)
    if (engagementRate > 5) score += 0.4;
    else if (engagementRate > 2) score += 0.3;
    else if (engagementRate > 1) score += 0.2;
    else score += 0.1;

    // Caption quality (30% weight)
    if (caption && caption.length > 50) score += 0.3;
    else if (caption && caption.length > 20) score += 0.2;
    else score += 0.1;

    // Absolute engagement (30% weight)
    if (likes > 1000) score += 0.3;
    else if (likes > 100) score += 0.2;
    else if (likes > 10) score += 0.1;

    return Math.min(score, 1);
  }

  // Detect spam content
  detectSpam(text) {
    const spamKeywords = [
      'follow4follow', 'like4like', 'f4f', 'l4l',
      'follow back', 'followback', 'follow me',
      'dm for', 'link in bio', 'check my',
      'free followers', 'get followers', 'buy followers',
      'click link', 'swipe up', 'limited time'
    ];

    const lowerText = text.toLowerCase();
    return spamKeywords.some(keyword => lowerText.includes(keyword));
  }

  // Sentiment analysis (positive/negative/neutral)
  analyzeSentiment(text) {
    const positiveWords = ['love', 'amazing', 'beautiful', 'great', 'awesome', 'perfect', 'best', 'wonderful'];
    const negativeWords = ['hate', 'bad', 'terrible', 'worst', 'awful', 'horrible', 'disgusting'];

    const lowerText = text.toLowerCase();
    
    const positiveCount = positiveWords.filter(word => lowerText.includes(word)).length;
    const negativeCount = negativeWords.filter(word => lowerText.includes(word)).length;

    if (positiveCount > negativeCount) return 'positive';
    if (negativeCount > positiveCount) return 'negative';
    return 'neutral';
  }
}

export default AIService;
