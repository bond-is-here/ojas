'use client';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
export default function VitalityHalo({
  breathing = false,
  paused = false,
}: {
  breathing?: boolean;
  paused?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const state = useRef({ breathing, paused });
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    state.current = { breathing, paused };
  }, [breathing, paused]);
  useEffect(() => {
    const host = container.current;
    if (!host) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: 'low-power',
      });
    } catch {
      // oxlint-disable-next-line react/react-compiler -- A failed external WebGL context must reveal the static fallback.
      setUnavailable(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    camera.position.z = 8.8;
    const group = new THREE.Group();
    scene.add(group);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `uniform float uTime; varying float vLight; varying float vAngle;
    void main(){ vec3 p = position; float angle = atan(p.y,p.x); float wave = sin(angle*5.0 + uTime*0.38 + p.z*2.1)*0.07;
    p.xy *= 1.0 + wave; p.z += sin(angle*3.0 + uTime*0.25)*0.19;
    vLight = 0.42 + 0.58 * pow(abs(normal.z),1.6); vAngle = angle;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p,1.0); }`,
      fragmentShader: `varying float vLight; varying float vAngle; uniform float uTime;
    void main(){vec3 mint=vec3(0.40,0.94,0.82); vec3 emerald=vec3(0.10,0.40,0.39);
    vec3 c=mix(emerald,mint,(sin(vAngle+0.8)+1.0)*0.5); gl_FragColor=vec4(c,vLight*0.17);}`,
      wireframe: true,
    });
    const geometry = new THREE.TorusGeometry(1.55, 0.4, 28, 160);
    const torus = new THREE.Mesh(geometry, material);
    group.add(torus);
    const geometry2 = new THREE.TorusGeometry(1.55, 0.36, 17, 120);
    const material2 = material.clone();
    const inner = new THREE.Mesh(geometry2, material2);
    inner.rotation.z = 0.08;
    inner.rotation.x = 0.15;
    group.add(inner);
    const particlePositions = new Float32Array(240 * 3);
    let seed = 42;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let i = 0; i < 240; i++) {
      const a = random() * Math.PI * 2;
      const r = 1.7 + random() * 0.8;
      particlePositions[i * 3] = Math.cos(a) * r;
      particlePositions[i * 3 + 1] = Math.sin(a) * r;
      particlePositions[i * 3 + 2] = (random() - 0.5) * 1.3;
    }
    const particlesGeo = new THREE.BufferGeometry();
    particlesGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(particlePositions, 3),
    );
    const particlesMat = new THREE.PointsMaterial({
      color: '#a5eed7',
      size: 0.014,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const particles = new THREE.Points(particlesGeo, particlesMat);
    group.add(particles);
    group.rotation.x = 0.25;
    group.rotation.y = -0.24;
    const resize = () => {
      const { width, height } = host.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    let visible = true;
    let frame = 0;
    let elapsed = 0;
    let last = 0;
    const pointer = { x: 0, y: 0 };
    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      pointer.x = ((e.clientX - r.left) / r.width - 0.5) * 0.2;
      pointer.y = ((e.clientY - r.top) / r.height - 0.5) * 0.2;
    };
    const onLeave = () => {
      pointer.x = 0;
      pointer.y = 0;
    };
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
    });
    intersection.observe(host);
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const delta = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (!visible || document.hidden) return;
      if (!reduce.matches && !state.current.paused) {
        elapsed += delta;
        material.uniforms.uTime.value = elapsed;
        material2.uniforms.uTime.value = elapsed + 3;
        particles.rotation.z = elapsed * 0.025;
        group.rotation.z = Math.sin(elapsed * 0.12) * 0.08;
      }
      group.rotation.y += (-0.24 + pointer.x - group.rotation.y) * 0.035;
      group.rotation.x += (0.25 + pointer.y - group.rotation.x) * 0.035;
      const scale =
        state.current.breathing && !reduce.matches
          ? 1 - Math.cos((elapsed * Math.PI) / 4) * 0.1
          : 1;
      group.scale.setScalar(scale);
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(draw);
    const onLoss = (e: Event) => {
      e.preventDefault();
      setUnavailable(true);
    };
    renderer.domElement.addEventListener('webglcontextlost', onLoss);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      intersection.disconnect();
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      renderer.domElement.removeEventListener('webglcontextlost', onLoss);
      geometry.dispose();
      geometry2.dispose();
      material.dispose();
      material2.dispose();
      particlesGeo.dispose();
      particlesMat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return (
    <div className="vitality-halo" ref={container} aria-hidden="true">
      {unavailable && (
        <svg viewBox="0 0 300 300" className="halo-fallback" aria-hidden="true">
          {[100, 106, 112, 118, 124].map((r) => (
            <circle
              key={r}
              cx="150"
              cy="150"
              r={r}
              fill="none"
              stroke="#a4d983"
              strokeOpacity={0.25}
              strokeWidth="2"
            />
          ))}
        </svg>
      )}
    </div>
  );
}
