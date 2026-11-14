import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'

/**
 * Escenas three.js de Optikax. Este módulo se carga aparte (lazy) para no pesar en el arranque.
 *
 * Rendimiento:
 * - frameloop "demand": no se dibuja nada salvo que algo pida un fotograma.
 * - Mientras `active` es true, un temporizador pide fotogramas a 30 fps; si es false, cero fotogramas.
 *   `active` lo decide la app: ventana visible y con foco, sin juego abierto y con efectos permitidos.
 * - dpr máximo 1.5, sin antialias ni sombras, una sola geometría Points por escena.
 */

const FPS = 30
const GREY = new THREE.Color('#b6b5c9')
const LIME = new THREE.Color('#d8f33a')

/** Pide fotogramas al ritmo fijo mientras la escena está activa. */
function Ticker({ active }: { active: boolean }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    invalidate()
    if (!active) return
    const id = setInterval(() => invalidate(), 1000 / FPS)
    return () => clearInterval(id)
  }, [active, invalidate])
  return null
}

const CANVAS_PROPS = {
  frameloop: 'demand' as const,
  dpr: [1, 1.5] as [number, number],
  gl: { antialias: false, alpha: true, powerPreference: 'low-power' as const }
}

// ---------- Núcleo ----------

const coreVertex = /* glsl */ `
  uniform float uTime;
  uniform float uRadius;
  uniform float uBurst;
  uniform float uPixelRatio;
  attribute float aSeed;
  varying float vGlow;
  varying float vDepth;

  void main() {
    vec3 n = normalize(position);
    // Ruido barato: dos ondas cruzadas que respiran sobre la superficie.
    float wave = sin(dot(n, vec3(3.1, 2.7, 1.9)) * 3.0 + uTime * 0.7) * 0.5
               + sin(dot(n, vec3(-1.7, 3.3, 2.2)) * 5.0 - uTime * 0.5) * 0.5;
    float r = uRadius * (1.0 + wave * 0.045) + aSeed * 0.06;
    // Purga: las partículas salen hacia fuera y vuelven.
    r += uBurst * (0.6 + aSeed * 1.4);
    vec4 mv = modelViewMatrix * vec4(n * r, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (1.6 + aSeed * 1.4) * uPixelRatio * (3.2 / -mv.z);
    // Zona "activa": un casquete superior con brillo lima.
    vGlow = smoothstep(0.55, 0.95, n.y + wave * 0.08);
    vDepth = smoothstep(-1.6, 1.2, mv.z + 4.0);
  }
`

const coreFragment = /* glsl */ `
  uniform vec3 uGrey;
  uniform vec3 uLime;
  varying float vGlow;
  varying float vDepth;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    float alpha = (1.0 - d * 2.0) * mix(0.25, 0.9, vDepth);
    gl_FragColor = vec4(mix(uGrey, uLime, vGlow * 0.85), alpha);
  }
`

function fibonacciSphere(count: number): { positions: Float32Array; seeds: Float32Array } {
  const positions = new Float32Array(count * 3)
  const seeds = new Float32Array(count)
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2
    const radius = Math.sqrt(1 - y * y)
    const theta = golden * i
    positions.set([Math.cos(theta) * radius, y, Math.sin(theta) * radius], i * 3)
    seeds[i] = Math.random()
  }
  return { positions, seeds }
}

function CorePoints({ usage, pulse, active }: { usage: number; pulse: number; active: boolean }) {
  const ref = useRef<THREE.Points>(null)
  const burstStart = useRef<number | null>(null)
  const { positions, seeds } = useMemo(() => fibonacciSphere(8000), [])
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uRadius: { value: 1 },
      uBurst: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.5) },
      uGrey: { value: GREY },
      uLime: { value: LIME }
    }),
    []
  )

  // Cada purga (pulse cambia) dispara la dispersión.
  useEffect(() => {
    if (pulse > 0) burstStart.current = performance.now()
  }, [pulse])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1)
    uniforms.uTime.value += active ? dt : 0
    // Más RAM en uso, núcleo más grande. Transición suave hacia el objetivo.
    const target = 1 + usage * 0.18
    uniforms.uRadius.value += (target - uniforms.uRadius.value) * Math.min(1, dt * 2)
    if (burstStart.current !== null) {
      const t = (performance.now() - burstStart.current) / 1400
      uniforms.uBurst.value = t >= 1 ? 0 : Math.sin(Math.PI * t) * (1 - t * 0.3)
      if (t >= 1) burstStart.current = null
    }
    if (ref.current && active) ref.current.rotation.y += dt * 0.12
  })

  return (
    <points ref={ref} rotation={[0.35, 0, 0.1]}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aSeed" args={[seeds, 1]} />
      </bufferGeometry>
      <shaderMaterial
        vertexShader={coreVertex}
        fragmentShader={coreFragment}
        uniforms={uniforms}
        transparent
        depthWrite={false}
      />
    </points>
  )
}

export function CoreScene(props: { usage: number; pulse: number; active: boolean }) {
  return (
    <Canvas {...CANVAS_PROPS} camera={{ position: [0, 0, 4], fov: 40 }}>
      <Ticker active={props.active} />
      <CorePoints {...props} />
    </Canvas>
  )
}

// ---------- Ola ----------

const waveVertex = /* glsl */ `
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vAlpha;

  void main() {
    vec3 p = position;
    p.y = sin(p.x * 0.55 + uTime * 0.6) * 0.35 + cos(p.z * 0.8 + uTime * 0.4) * 0.25;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = 2.0 * uPixelRatio * (6.0 / -mv.z);
    // Se desvanece hacia el fondo y los bordes.
    vAlpha = smoothstep(-16.0, -4.0, mv.z) * (1.0 - smoothstep(9.0, 14.0, abs(p.x)));
  }
`

const waveFragment = /* glsl */ `
  uniform vec3 uGrey;
  varying float vAlpha;

  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(uGrey, (1.0 - d * 2.0) * vAlpha * 0.7);
  }
`

function WavePoints({ active }: { active: boolean }) {
  const positions = useMemo(() => {
    const cols = 160
    const rows = 48
    const out = new Float32Array(cols * rows * 3)
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        out.set([(c / (cols - 1) - 0.5) * 28, 0, -(r / (rows - 1)) * 14], (r * cols + c) * 3)
      }
    }
    return out
  }, [])
  const uniforms = useMemo(
    () => ({ uTime: { value: 0 }, uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.5) }, uGrey: { value: GREY } }),
    []
  )
  const pointer = useThree((s) => s.pointer)

  useFrame(({ camera }, delta) => {
    if (!active) return
    uniforms.uTime.value += Math.min(delta, 0.1)
    // Paralaje suave con el mouse: la cámara persigue el puntero con retardo.
    camera.position.x += (pointer.x * 0.8 - camera.position.x) * 0.05
    camera.position.y += (2.2 + pointer.y * 0.3 - camera.position.y) * 0.05
    camera.lookAt(0, 0, -5)
  })

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <shaderMaterial vertexShader={waveVertex} fragmentShader={waveFragment} uniforms={uniforms} transparent depthWrite={false} />
    </points>
  )
}

export function WaveScene({ active }: { active: boolean }) {
  return (
    <Canvas {...CANVAS_PROPS} camera={{ position: [0, 2.2, 4], fov: 55 }}>
      <Ticker active={active} />
      <WavePoints active={active} />
    </Canvas>
  )
}
