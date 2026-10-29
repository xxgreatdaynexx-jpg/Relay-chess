export class GameError extends Error {
  fatal: boolean;

  constructor(message: string, fatal = false) {
    super(message);
    this.name = 'GameError';
    this.fatal = fatal;
  }
}
