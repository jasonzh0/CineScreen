/**
 * Professional-quality motion smoothing for cursor and zoom
 * Inspired by Screen Studio's butter-smooth animations
 */

import {
  DEFAULT_VELOCITY_THRESHOLD,
  DEFAULT_MIN_SMOOTH_TIME,
  SMOOTHDAMP_COEFFICIENT_1,
  SMOOTHDAMP_COEFFICIENT_2,
  SMOOTHDAMP_CONVERGENCE_THRESHOLD,
} from '../utils/constants';

/**
 * Spring physics state for smooth following
 */
interface SpringState {
  position: number;
  velocity: number;
}

/**
 * 2D Spring state
 */
interface Spring2D {
  x: SpringState;
  y: SpringState;
}

/**
 * Spring physics configuration
 * - stiffness: How quickly the spring responds (higher = faster, less smooth)
 * - damping: How quickly oscillations settle (higher = less bouncy)
 * - mass: Inertia of the system (higher = slower, more momentum)
 */
interface SpringConfig {
  stiffness: number;
  damping: number;
  mass: number;
}

/**
 * Preset spring configurations for different use cases
 */
const SPRING_PRESETS = {
  // Smooth and gentle - great for zoom following
  gentle: { stiffness: 120, damping: 20, mass: 1 },
  // Balanced smoothness with good responsiveness
  smooth: { stiffness: 180, damping: 24, mass: 1 },
  // Snappy but still smooth
  snappy: { stiffness: 300, damping: 30, mass: 1 },
  // Very slow, cinematic movement
  cinematic: { stiffness: 80, damping: 18, mass: 1.5 },
  // Screen Studio-like feel
  screenStudio: { stiffness: 150, damping: 22, mass: 1.2 },
} as const;

/**
 * Animation style presets (Screen Studio-like)
 * Maps to smooth time values for SmoothDamp algorithm
 * Higher smoothTime = smoother/slower cursor following
 */
const ANIMATION_STYLES = {
  slow: {
    smoothTime: 0.45, // Very slow, dramatic
    minSmoothTime: 0.15,
  },
  mellow: {
    smoothTime: 0.25, // Professional, balanced (default) - Screen Studio-like
    minSmoothTime: 0.08,
  },
  quick: {
    smoothTime: 0.12, // Responsive but still smooth
    minSmoothTime: 0.04,
  },
  rapid: {
    smoothTime: 0.06, // Very fast, minimal smoothing
    minSmoothTime: 0.02,
  },
} as const;

/**
 * Simulate spring physics for one time step
 * Uses a critically damped spring for smooth, non-oscillating motion
 */
function simulateSpring(
  state: SpringState,
  target: number,
  config: SpringConfig,
  deltaTime: number
): SpringState {
  const { stiffness, damping, mass } = config;
  
  // Calculate spring force: F = -k * displacement
  const displacement = state.position - target;
  const springForce = -stiffness * displacement;
  
  // Calculate damping force: F = -c * velocity
  const dampingForce = -damping * state.velocity;
  
  // Total acceleration: a = F / m
  const acceleration = (springForce + dampingForce) / mass;
  
  // Update velocity and position using semi-implicit Euler integration
  const newVelocity = state.velocity + acceleration * deltaTime;
  const newPosition = state.position + newVelocity * deltaTime;
  
  return {
    position: newPosition,
    velocity: newVelocity,
  };
}

/**
 * Create a new 2D spring state
 */
function createSpring2D(x: number, y: number): Spring2D {
  return {
    x: { position: x, velocity: 0 },
    y: { position: y, velocity: 0 },
  };
}

/**
 * Update a 2D spring towards a target position
 */
function updateSpring2D(
  spring: Spring2D,
  targetX: number,
  targetY: number,
  config: SpringConfig,
  deltaTime: number
): Spring2D {
  return {
    x: simulateSpring(spring.x, targetX, config, deltaTime),
    y: simulateSpring(spring.y, targetY, config, deltaTime),
  };
}

/**
 * Bezier easing functions for smooth transitions
 */
const EASING = {
  // Smooth start and end
  easeInOutCubic: (t: number): number => {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  },
  
  // Smooth start and end (quintic - even smoother)
  easeInOutQuint: (t: number): number => {
    return t < 0.5 ? 16 * t * t * t * t * t : 1 - Math.pow(-2 * t + 2, 5) / 2;
  },
  
  // Very smooth, almost linear in the middle
  easeInOutSine: (t: number): number => {
    return -(Math.cos(Math.PI * t) - 1) / 2;
  },
  
  // Smooth deceleration (great for ending animations)
  easeOutQuart: (t: number): number => {
    return 1 - Math.pow(1 - t, 4);
  },
  
  // Smooth acceleration (great for starting animations)
  easeInQuart: (t: number): number => {
    return t * t * t * t;
  },
  
  // Custom bezier approximation for Screen Studio-like feel
  screenStudio: (t: number): number => {
    // Approximates cubic-bezier(0.4, 0, 0.2, 1)
    const c1 = 0.4;
    const c2 = 0.0;
    const c3 = 0.2;
    const c4 = 1.0;
    
    // Approximate bezier evaluation
    const t2 = t * t;
    const t3 = t2 * t;
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;
    
    return 3 * mt2 * t * c2 + 3 * mt * t2 * c4 + t3;
  },
};

/**
 * Smooth value interpolation with momentum
 * Great for zoom level transitions
 */
export class SmoothValue {
  private current: number;
  private target: number;
  private velocity: number = 0;
  private readonly smoothTime: number;
  
  constructor(initial: number, smoothTime: number = 0.3) {
    this.current = initial;
    this.target = initial;
    this.smoothTime = smoothTime;
  }
  
  setTarget(target: number): void {
    this.target = target;
  }
  
  /**
   * Update using critically damped spring (SmoothDamp algorithm)
   * This is the same algorithm Unity uses for smooth following
   */
  update(deltaTime: number): number {
    if (Math.abs(this.current - this.target) < SMOOTHDAMP_CONVERGENCE_THRESHOLD && Math.abs(this.velocity) < SMOOTHDAMP_CONVERGENCE_THRESHOLD) {
      this.current = this.target;
      this.velocity = 0;
      return this.current;
    }
    
    // Critically damped spring coefficients
    const omega = 2 / this.smoothTime;
    const x = omega * deltaTime;
    const exp = 1 / (1 + x + SMOOTHDAMP_COEFFICIENT_1 * x * x + SMOOTHDAMP_COEFFICIENT_2 * x * x * x);
    
    const change = this.current - this.target;
    const temp = (this.velocity + omega * change) * deltaTime;
    
    this.velocity = (this.velocity - omega * temp) * exp;
    this.current = this.target + (change + temp) * exp;
    
    return this.current;
  }
  
  getValue(): number {
    return this.current;
  }
}

/**
 * 2D position smoother with velocity and momentum
 */
export class SmoothPosition2D {
  private currentX: number;
  private currentY: number;
  private targetX: number;
  private targetY: number;
  private velocityX: number = 0;
  private velocityY: number = 0;
  private readonly smoothTime: number;
  
  constructor(x: number, y: number, smoothTime: number = 0.2) {
    this.currentX = x;
    this.currentY = y;
    this.targetX = x;
    this.targetY = y;
    this.smoothTime = smoothTime;
  }
  
  setTarget(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
  }
  
  /**
   * SmoothDamp for 2D positions
   */
  update(deltaTime: number): { x: number; y: number } {
    const omega = 2 / this.smoothTime;
    const x = omega * deltaTime;
    const exp = 1 / (1 + x + SMOOTHDAMP_COEFFICIENT_1 * x * x + SMOOTHDAMP_COEFFICIENT_2 * x * x * x);
    
    // X axis
    const changeX = this.currentX - this.targetX;
    const tempX = (this.velocityX + omega * changeX) * deltaTime;
    this.velocityX = (this.velocityX - omega * tempX) * exp;
    this.currentX = this.targetX + (changeX + tempX) * exp;
    
    // Y axis
    const changeY = this.currentY - this.targetY;
    const tempY = (this.velocityY + omega * changeY) * deltaTime;
    this.velocityY = (this.velocityY - omega * tempY) * exp;
    this.currentY = this.targetY + (changeY + tempY) * exp;
    
    return { x: this.currentX, y: this.currentY };
  }
  
  getPosition(): { x: number; y: number } {
    return { x: this.currentX, y: this.currentY };
  }
  
  getVelocity(): { x: number; y: number } {
    return { x: this.velocityX, y: this.velocityY };
  }
}

/**
 * Dead zone to prevent micro-movements when cursor is nearly stationary
 */
function applyDeadZone(
  current: { x: number; y: number },
  target: { x: number; y: number },
  deadZoneRadius: number
): { x: number; y: number } {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  
  if (distance < deadZoneRadius) {
    return current;
  }
  
  // Scale movement to start from edge of dead zone
  const scale = (distance - deadZoneRadius) / distance;
  return {
    x: current.x + dx * scale,
    y: current.y + dy * scale,
  };
}

/**
 * Velocity-based adaptive smoothing
 * Faster movements = less smoothing (more responsive)
 * Slower movements = more smoothing (more cinematic)
 */
function getAdaptiveSmoothTime(
  velocityX: number,
  velocityY: number,
  baseSmoothTime: number,
  minSmoothTime: number = DEFAULT_MIN_SMOOTH_TIME,
  velocityThreshold: number = DEFAULT_VELOCITY_THRESHOLD
): number {
  const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
  const speedFactor = Math.min(1, speed / velocityThreshold);
  
  // Lerp between base and min smooth time based on speed
  return baseSmoothTime - (baseSmoothTime - minSmoothTime) * speedFactor;
}

