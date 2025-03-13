class Logger {
  private static loggingEnabled = true; // Default: Logging is ON

  static enableLogging(enabled: boolean) {
    this.loggingEnabled = enabled;
  }

  static log(...args: any[]) {
    if (this.loggingEnabled) {
      console.log(...args);
    }
  }

  static error(...args: any[]) {
    if (this.loggingEnabled) {
      console.error(...args);
    }
  }
}

export default Logger;
