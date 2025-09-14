export {};

declare global {
  // Extend Express Request if needed later
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

