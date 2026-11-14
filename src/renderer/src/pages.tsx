import type { ReactNode } from 'react'
import type { TitleBarTheme } from '@shared/types'

export type PageId = 'panel' | 'optimizar' | 'memoria' | 'juego' | 'ajustes'

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
    lede: 'Detecta tu hardware y lo ajusta solo con cambios seguros y reversibles.'
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
    lede: 'Efectos 3D, inicio con Windows, memoria, Modo Juego y respaldo.'
  }
]
