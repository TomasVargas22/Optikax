import type { ReactNode } from 'react'
import type { TitleBarTheme } from '@shared/types'

export type PageId = 'panel' | 'optimizar' | 'memoria' | 'ia' | 'juego' | 'ajustes'

export interface PageDef {
  id: PageId
  label: string
  theme: TitleBarTheme
  eyebrow: string
  title: ReactNode
  lede: string
}

/** Contenido provisional: cada pantalla se construye en su fase. */
export const PAGES: PageDef[] = [
  {
    id: 'panel',
    label: 'Panel',
    theme: 'oscuro',
    eyebrow: 'Optikax',
    title: (
      <>
        Detecta <em>ajusta</em> juega
      </>
    ),
    lede: 'Tu hardware, analizado contra lo que recomiendan los foros, y aplicado solo con ajustes seguros y reversibles.'
  },
  {
    id: 'optimizar',
    label: 'Optimizar',
    theme: 'claro',
    eyebrow: 'Ajustes seguros',
    title: (
      <>
        Pensados para <em>tu</em> hardware
      </>
    ),
    lede: 'Ningún ajuste desactiva servicios ni seguridad. Todo se puede revertir con un clic.'
  },
  {
    id: 'memoria',
    label: 'Memoria',
    theme: 'oscuro',
    eyebrow: 'Liberador de RAM',
    title: (
      <>
        Memoria <em>libre</em>
      </>
    ),
    lede: 'Limpieza de la standby list y los working sets, a mano o automática.'
  },
  {
    id: 'ia',
    label: 'Análisis IA',
    theme: 'oscuro',
    eyebrow: 'Claude + búsqueda web',
    title: (
      <>
        Lo que dicen <em>los foros</em>
      </>
    ),
    lede: 'Busca qué recomienda la comunidad para tus componentes exactos y te lo explica con fuentes.'
  },
  {
    id: 'juego',
    label: 'Modo Juego',
    theme: 'oscuro',
    eyebrow: 'Automático',
    title: (
      <>
        Abre el juego, <em>nada más</em>
      </>
    ),
    lede: 'Detecta el juego, le da prioridad y limpia la memoria. Al cerrarlo, todo vuelve a como estaba.'
  },
  {
    id: 'ajustes',
    label: 'Ajustes',
    theme: 'oscuro',
    eyebrow: 'Preferencias',
    title: (
      <>
        A tu <em>manera</em>
      </>
    ),
    lede: 'API key, efectos 3D, inicio con Windows y umbrales de memoria.'
  }
]
