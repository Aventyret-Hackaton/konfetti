// A cartoon glove that stands in for the mouse pointer: it hovers over the ground and pinches
// confetti. Four fingers, a puffy cuff and three stitches on the back, as cartoon gloves have.
import * as THREE from 'three';

/**
 * Returns { group, setGrab(on), update(dt, t) }.
 * The group's origin is the spot the fingertips reach for; the back of the hand faces local +z,
 * so turn the group to keep +z toward the camera.
 */
export function createHand() {
  const glove = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.5 });
  const ink = new THREE.MeshBasicMaterial({ color: '#22242e' });
  const group = new THREE.Group();
  const hand = new THREE.Group(); // everything, so the whole glove can dip and tilt inside the group
  group.add(hand);

  const palm = new THREE.Mesh(new THREE.SphereGeometry(0.36, 28, 20), glove);
  palm.scale.set(1.08, 1, 0.64);
  palm.position.y = 0.95;
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.14, 14, 32).rotateX(Math.PI / 2), glove);
  cuff.scale.z = 0.8;
  cuff.position.y = 1.36;
  hand.add(palm, cuff);
  for (const x of [-0.13, 0, 0.13]) {
    const stitch = new THREE.Mesh(new THREE.CapsuleGeometry(0.02, 0.2, 3, 8), ink);
    stitch.position.set(x, 1.0, 0.222);
    hand.add(stitch);
  }

  // A digit is two fat capsules hinged at a knuckle and a joint. Curling turns both toward the palm side (-z).
  function digit(x, y, z, length, radius) {
    const segment = new THREE.CapsuleGeometry(radius, length, 5, 14).translate(0, -length / 2, 0);
    const knuckle = new THREE.Group(), joint = new THREE.Group();
    knuckle.position.set(x, y, z);
    joint.position.y = -length;
    joint.add(new THREE.Mesh(segment, glove));
    knuckle.add(new THREE.Mesh(segment, glove), joint);
    hand.add(knuckle);
    return { knuckle, joint };
  }
  const fingers = [
    { ...digit(-0.25, 0.72, 0, 0.25, 0.108), splay: 0.3 },
    { ...digit(0, 0.68, 0, 0.3, 0.112), splay: 0 },
    { ...digit(0.25, 0.72, 0, 0.25, 0.108), splay: -0.3 },
  ];
  const thumb = digit(-0.36, 0.98, -0.1, 0.2, 0.115);
  hand.traverse(o => { if (o.isMesh) o.castShadow = true; });

  let grab = 0, target = 0; // 0 = open and relaxed, 1 = pinching

  return {
    group,
    setGrab(on) { target = on ? 1 : 0; },
    update(dt, t) {
      grab += (target - grab) * Math.min(1, dt * 16);
      const idle = Math.sin(t * 2.2) * 0.04 * (1 - grab); // open fingers drum a little
      fingers.forEach((f, i) => {
        f.knuckle.rotation.set(-0.12 + grab * 0.75 + idle * (i - 1), 0, f.splay * (1 - grab * 0.8));
        f.joint.rotation.x = 0.1 + grab * 0.95;
      });
      // The thumb hangs off the side when open and swings under the palm to meet the fingers.
      thumb.knuckle.rotation.set(grab * 0.9, 0, -0.95 + grab * 0.75);
      thumb.joint.rotation.set(grab * 0.5, 0, 0.35);
      // Curled fingertips sit higher and nearer the palm than open ones; move the glove so the pinch stays on the origin.
      hand.position.set(0, 0.06 - grab * 0.3 + Math.sin(t * 2.2) * 0.02, grab * 0.34);
      hand.rotation.x = -0.18 - grab * 0.12;
    },
  };
}
