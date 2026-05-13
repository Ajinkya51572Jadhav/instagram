// Scheduler Helper Functions

export class SchedulerService {
  constructor() {
    this.schedules = [];
    this.activeSchedule = null;
  }

  // Check if current time is within active hours
  isWithinActiveHours(schedule) {
    const now = new Date();
    const currentTime = now.getHours() * 60 + now.getMinutes();
    const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday

    // Check if today is in active days
    if (schedule.daysOfWeek && !schedule.daysOfWeek.includes(currentDay)) {
      return false;
    }

    // Parse start and end times
    const [startHour, startMin] = schedule.startTime.split(':').map(Number);
    const [endHour, endMin] = schedule.endTime.split(':').map(Number);

    const startTime = startHour * 60 + startMin;
    const endTime = endHour * 60 + endMin;

    return currentTime >= startTime && currentTime <= endTime;
  }

  // Get next scheduled time
  getNextScheduledTime(schedule) {
    const now = new Date();
    const [startHour, startMin] = schedule.startTime.split(':').map(Number);

    const nextRun = new Date();
    nextRun.setHours(startHour, startMin, 0, 0);

    // If time has passed today, schedule for tomorrow
    if (nextRun <= now) {
      nextRun.setDate(nextRun.getDate() + 1);
    }

    // Check days of week
    while (schedule.daysOfWeek && !schedule.daysOfWeek.includes(nextRun.getDay())) {
      nextRun.setDate(nextRun.getDate() + 1);
    }

    return nextRun;
  }

  // Calculate time until next run
  getTimeUntilNextRun(schedule) {
    const nextRun = this.getNextScheduledTime(schedule);
    const now = new Date();
    const diff = nextRun - now;

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    return { hours, minutes, timestamp: nextRun };
  }

  // Create schedule
  createSchedule(name, startTime, endTime, daysOfWeek = [1, 2, 3, 4, 5]) {
    return {
      id: Date.now(),
      name,
      startTime,
      endTime,
      daysOfWeek, // 0 = Sunday, 6 = Saturday
      isActive: true,
      createdAt: new Date().toISOString()
    };
  }

  // Preset schedules
  getPresets() {
    return {
      morning: this.createSchedule('Morning', '09:00', '12:00'),
      afternoon: this.createSchedule('Afternoon', '12:00', '17:00'),
      evening: this.createSchedule('Evening', '17:00', '23:00'),
      businessHours: this.createSchedule('Business Hours', '09:00', '18:00'),
      peakHours: this.createSchedule('Peak Hours', '18:00', '22:00'),
      weekdaysOnly: this.createSchedule('Weekdays Only', '09:00', '23:00', [1, 2, 3, 4, 5]),
      weekendsOnly: this.createSchedule('Weekends Only', '10:00', '22:00', [0, 6]),
      allDay: this.createSchedule('All Day', '00:00', '23:59', [0, 1, 2, 3, 4, 5, 6])
    };
  }

  // Check if weekend mode
  isWeekend() {
    const day = new Date().getDay();
    return day === 0 || day === 6;
  }

  // Get day name
  getDayName(dayIndex) {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[dayIndex];
  }

  // Format time for display
  formatTime(time) {
    const [hours, minutes] = time.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  }

  // Validate schedule
  validateSchedule(schedule) {
    const errors = [];

    if (!schedule.name) errors.push('Schedule name is required');
    if (!schedule.startTime) errors.push('Start time is required');
    if (!schedule.endTime) errors.push('End time is required');

    // Check if end time is after start time
    const [startHour, startMin] = schedule.startTime.split(':').map(Number);
    const [endHour, endMin] = schedule.endTime.split(':').map(Number);
    
    if (endHour < startHour || (endHour === startHour && endMin <= startMin)) {
      errors.push('End time must be after start time');
    }

    if (!schedule.daysOfWeek || schedule.daysOfWeek.length === 0) {
      errors.push('At least one day must be selected');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

export default SchedulerService;
