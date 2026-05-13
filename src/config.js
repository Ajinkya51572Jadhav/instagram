// Instagram Pro Configuration

export const INSTAGRAM_LIMITS = {
  DAILY_LIKES: 350,
  DAILY_FOLLOWS: 150,
  DAILY_UNFOLLOWS: 150,
  DAILY_COMMENTS: 50,
  DAILY_STORIES: 200,
  HOURLY_LIKES: 60,
  HOURLY_FOLLOWS: 30,
  HOURLY_COMMENTS: 10,
};

export const TARGETING_OPTIONS = {
  HASHTAGS: [
    '#photography', '#travel', '#food', '#fitness', '#fashion',
    '#art', '#nature', '#lifestyle', '#motivation', '#business'
  ],
  LOCATIONS: [
    'New York', 'Los Angeles', 'London', 'Paris', 'Tokyo',
    'Dubai', 'Mumbai', 'Delhi', 'Bangalore', 'Singapore'
  ],
  MIN_ENGAGEMENT_RATE: 2, // percentage
  MIN_FOLLOWERS: 100,
  MAX_FOLLOWERS: 100000,
  VERIFIED_ONLY: false,
};

export const COMMENT_TEMPLATES = {
  GENERIC: [
    'Amazing! 🔥',
    'Love this! ❤️',
    'Great content! 👏',
    'Awesome! 😍',
    'Beautiful! ✨',
    'Incredible! 🙌',
    'So good! 💯',
    'Perfect! 👌',
    'Stunning! 🌟',
    'Fantastic! 🎉',
  ],
  PHOTO: [
    'Beautiful shot! 📸',
    'Great composition! 🎨',
    'Love the colors! 🌈',
    'Amazing photo! 📷',
    'Perfect lighting! ✨',
  ],
  VIDEO: [
    'Great video! 🎥',
    'Love the editing! 🎬',
    'Amazing content! 📹',
    'Well done! 👏',
    'Keep it up! 🔥',
  ],
  TRAVEL: [
    'Beautiful place! 🌍',
    'Where is this? 📍',
    'Added to my bucket list! ✈️',
    'Stunning view! 🏔️',
    'Dream destination! 🌴',
  ],
  FOOD: [
    'Looks delicious! 🍕',
    'Yummy! 😋',
    'Making me hungry! 🤤',
    'Recipe please! 👨‍🍳',
    'Mouth-watering! 🍽️',
  ],
};

export const SCHEDULER_PRESETS = {
  MORNING: { start: '09:00', end: '12:00' },
  AFTERNOON: { start: '12:00', end: '17:00' },
  EVENING: { start: '17:00', end: '23:00' },
  BUSINESS_HOURS: { start: '09:00', end: '18:00' },
  PEAK_HOURS: { start: '18:00', end: '22:00' },
};

export const AI_SETTINGS = {
  OPENAI_API_KEY: '', // User will add their key
  MODEL: 'gpt-3.5-turbo',
  MAX_TOKENS: 50,
  TEMPERATURE: 0.7,
  MIN_QUALITY_SCORE: 0.6, // 0-1 scale
};

export const PROXY_SETTINGS = {
  ENABLED: false,
  TYPE: 'http', // http, https, socks5
  HOST: '',
  PORT: '',
  USERNAME: '',
  PASSWORD: '',
  ROTATE_INTERVAL: 30, // minutes
};

export const FILTER_SETTINGS = {
  MIN_LIKES: 10,
  MIN_COMMENTS: 0,
  MAX_HASHTAGS: 30,
  SKIP_KEYWORDS: ['spam', 'fake', 'bot', 'follow4follow', 'like4like'],
  REQUIRED_KEYWORDS: [],
  POST_TYPES: ['photo', 'video', 'carousel'], // all enabled by default
  VERIFIED_ONLY: false,
  MIN_FOLLOWERS: 0,
  MAX_FOLLOWERS: 1000000,
};

export const ACCOUNT_PROFILES = {
  DEFAULT: {
    name: 'Default Account',
    username: '',
    settings: {},
    stats: {},
  },
};

export const STORY_SETTINGS = {
  AUTO_VIEW: true,
  SKIP_ADS: true,
  VIEW_DURATION: { min: 3000, max: 8000 }, // milliseconds
  MAX_STORIES_PER_SESSION: 50,
  SKIP_SEEN: true,
};

export const FOLLOW_UNFOLLOW_SETTINGS = {
  AUTO_FOLLOW: false,
  AUTO_UNFOLLOW: false,
  UNFOLLOW_AFTER_DAYS: 3,
  FOLLOW_BACK_ONLY: false,
  WHITELIST: [], // usernames to never unfollow
  FOLLOW_RATIO_LIMIT: 1.5, // following/followers ratio
};
