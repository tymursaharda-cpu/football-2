/*
 * Web Worker responsible for running the Box2D physics simulation.
 * It loads the box2d-wasm module, builds a simple world with two
 * players and a ball, steps the simulation at a fixed 120 Hz, and
 * communicates the state back to the main thread. Inputs from the
 * main thread (movement, jump commands) are applied to the
 * corresponding dynamic bodies. Goals are detected when the ball
 * leaves the horizontal bounds and a message is posted.
 */

// Load the WebAssembly build of Box2D via jsDelivr. When loaded
// Box2D() returns a promise which resolves with the Module object.
importScripts('https://cdn.jsdelivr.net/npm/box2d-wasm@7.0.0/dist/umd/Box2D.js');

let Module;
let world;
const bodies = {};
// World parameters: width and height in metres. Gravity is expressed
// in metres/second^2. We invert gravity because Box2D uses a
// coordinate system where positive y is up; in our game, positive y
// is downwards on screen.
const WORLD_WIDTH = 10;
const WORLD_HEIGHT = 5;
const GRAVITY = -9.81;
const PLAYER_RADIUS = 0.3;
const BALL_RADIUS = 0.11;

// Initialize the Box2D module and set up the world. Once ready,
// begin stepping the simulation.
Box2D().then((B2) => {
  Module = B2;
  setupWorld();
  // Step the world at 120 Hz. Using setInterval is sufficient here
  // because the worker runs off the main thread.
  setInterval(stepWorld, 1000 / 120);
});

function setupWorld() {
  const gravityVec = new Module.b2Vec2(0, GRAVITY);
  world = new Module.b2World(gravityVec);

  // Ground – static body spanning the entire width at y=0.
  let bd = new Module.b2BodyDef();
  bd.set_type(Module.b2_staticBody);
  bd.set_position(new Module.b2Vec2(WORLD_WIDTH / 2, 0));
  const ground = world.CreateBody(bd);
  let shape = new Module.b2PolygonShape();
  shape.SetAsBox(WORLD_WIDTH / 2, 0.1);
  ground.CreateFixture(shape, 0);

  // Left wall
  bd = new Module.b2BodyDef();
  bd.set_type(Module.b2_staticBody);
  bd.set_position(new Module.b2Vec2(0, WORLD_HEIGHT / 2));
  const leftWall = world.CreateBody(bd);
  shape = new Module.b2PolygonShape();
  shape.SetAsBox(0.1, WORLD_HEIGHT / 2);
  leftWall.CreateFixture(shape, 0);

  // Right wall
  bd = new Module.b2BodyDef();
  bd.set_type(Module.b2_staticBody);
  bd.set_position(new Module.b2Vec2(WORLD_WIDTH, WORLD_HEIGHT / 2));
  const rightWall = world.CreateBody(bd);
  shape = new Module.b2PolygonShape();
  shape.SetAsBox(0.1, WORLD_HEIGHT / 2);
  rightWall.CreateFixture(shape, 0);

  // Create dynamic bodies
  createBall();
  createPlayer(1, 2);
  createPlayer(2, WORLD_WIDTH - 2);
}

function createBall() {
  const bodyDef = new Module.b2BodyDef();
  bodyDef.set_type(Module.b2_dynamicBody);
  bodyDef.set_position(new Module.b2Vec2(WORLD_WIDTH / 2, WORLD_HEIGHT - 1));
  bodyDef.set_bullet(true);
  const body = world.CreateBody(bodyDef);
  const circle = new Module.b2CircleShape();
  circle.set_m_radius(BALL_RADIUS);
  const fixtureDef = new Module.b2FixtureDef();
  fixtureDef.set_shape(circle);
  fixtureDef.set_density(0.5);
  fixtureDef.set_restitution(0.82);
  fixtureDef.set_friction(0.01);
  body.CreateFixture(fixtureDef);
  bodies.ball = body;
}

function createPlayer(id, x) {
  const bodyDef = new Module.b2BodyDef();
  bodyDef.set_type(Module.b2_dynamicBody);
  bodyDef.set_position(new Module.b2Vec2(x, 1));
  bodyDef.set_fixedRotation(true);
  const body = world.CreateBody(bodyDef);
  const circle = new Module.b2CircleShape();
  circle.set_m_radius(PLAYER_RADIUS);
  const fixtureDef = new Module.b2FixtureDef();
  fixtureDef.set_shape(circle);
  fixtureDef.set_density(1.0);
  fixtureDef.set_friction(0.2);
  fixtureDef.set_restitution(0.1);
  body.CreateFixture(fixtureDef);
  bodies[id] = body;
}

function resetPositions() {
  // Reset ball
  const ball = bodies.ball;
  ball.SetTransform(new Module.b2Vec2(WORLD_WIDTH / 2, WORLD_HEIGHT - 1), 0);
  ball.SetLinearVelocity(new Module.b2Vec2(0, 0));
  ball.SetAngularVelocity(0);
  // Reset players
  const p1 = bodies[1];
  p1.SetTransform(new Module.b2Vec2(2, 1), 0);
  p1.SetLinearVelocity(new Module.b2Vec2(0, 0));
  const p2 = bodies[2];
  p2.SetTransform(new Module.b2Vec2(WORLD_WIDTH - 2, 1), 0);
  p2.SetLinearVelocity(new Module.b2Vec2(0, 0));
}

function stepWorld() {
  world.Step(1 / 120, 8, 3);
  // Detect goal when the ball leaves bounds. Negative x means left wall,
  // greater than WORLD_WIDTH means right wall.
  const ballPos = bodies.ball.GetPosition();
  let goal = null;
  if (ballPos.get_x() < -0.5) {
    goal = 'right';
  } else if (ballPos.get_x() > WORLD_WIDTH + 0.5) {
    goal = 'left';
  }
  if (goal) {
    postMessage({ type: 'goal', scorer: goal });
    resetPositions();
  }
  // Build state snapshot. Each entry includes position and velocity.
  const snapshot = {};
  for (const key in bodies) {
    const b = bodies[key];
    const pos = b.GetPosition();
    const vel = b.GetLinearVelocity();
    snapshot[key] = {
      x: pos.get_x(),
      y: pos.get_y(),
      vx: vel.get_x(),
      vy: vel.get_y()
    };
  }
  postMessage({ type: 'state', state: snapshot });
}

function handleInput(data) {
  const id = data.id;
  const input = data.input;
  const body = bodies[id];
  if (!body) return;
  const vel = body.GetLinearVelocity();
  const speed = 4; // metres per second horizontal target
  let vx = 0;
  if (input.left && !input.right) {
    vx = -speed;
  } else if (input.right && !input.left) {
    vx = speed;
  }
  body.SetLinearVelocity(new Module.b2Vec2(vx, vel.get_y()));
  // Jump if near ground and not already moving upward
  if (input.jump) {
    const pos = body.GetPosition();
    if (pos.get_y() <= PLAYER_RADIUS + 0.05 && Math.abs(vel.get_y()) < 0.1) {
      const jumpImpulse = 6.2; // approximate jump velocity
      const impulse = new Module.b2Vec2(0, jumpImpulse * body.GetMass());
      body.ApplyLinearImpulse(impulse, body.GetWorldCenter(), true);
    }
  }
}

self.onmessage = (event) => {
  const data = event.data;
  if (data.type === 'input') {
    handleInput(data);
  } else if (data.type === 'reset') {
    resetPositions();
  } else if (data.type === 'super') {
    // Apply an extra vertical impulse for a super‑jump. This is a one‑time
    // boost triggered by the main thread when the player activates their
    // special ability. The magnitude is tuned to feel impactful but not
    // overpowered. Only dynamic bodies (players) respond to this message.
    const id = data.id;
    const body = bodies[id];
    if (body) {
      const mass = body.GetMass();
      const impulseMag = 12.0; // increase impulse compared to regular jump
      const impulse = new Module.b2Vec2(0, impulseMag * mass);
      body.ApplyLinearImpulse(impulse, body.GetWorldCenter(), true);
    }
  }
};