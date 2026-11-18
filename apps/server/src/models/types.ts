import type { Manifest, ModelEntry } from '../core/types'

export interface RuleModelFile {
  kind: 'rule'
  T: number
  N: number
  mode: 'fut' | 'both' | 'all4'
  has_spot: boolean
  has_btc?: boolean
  edge_only: boolean
  name?: string
}

export interface LogRegModelFile {
  kind: 'logreg'
  features: string[]
  classes: number[]
  coef: number[][]
  intercept: number[]
  mean: number[]
  std: number[]
  clip: number
  name?: string
}

export interface XgbTree {
  cls: number
  f: number[]
  v: number[]
  l: number[]
  r: number[]
  m: number[]
}

export interface XgbModelFile {
  kind: 'xgb' | 'meta'
  features: string[]
  n_class: number
  trees: XgbTree[]
  offset: number[]
  rounds?: number
  n_features?: number
  name?: string
}

export interface MetaModelFile {
  kind: 'meta'
  T: number
  N: number
  features: string[]
  extra_features?: string[]
  xgb: XgbModelFile
  name?: string
}

export interface GruLayer {
  w_ih: number[][]
  w_hh: number[][]
  b_ih: number[]
  b_hh: number[]
}

export interface GruModelFile {
  kind: 'gru'
  features: string[]
  seq_len: number
  hidden: number
  clip: number
  layers: GruLayer[]
  head: { ln_w: number[]; ln_b: number[]; ln_eps: number; fc_w: number[][]; fc_b: number[] }
  mean: number[]
  std: number[]
  name?: string
}

export interface EnsembleModelFile {
  kind: 'ensemble'
  members: string[]
  name?: string
}

export type AnyModelFile =
  | RuleModelFile
  | LogRegModelFile
  | XgbModelFile
  | MetaModelFile
  | GruModelFile
  | EnsembleModelFile

export interface LoadedModel {
  entry: ModelEntry
  file: AnyModelFile
}

export interface ModelBundle {
  manifest: Manifest
  models: Map<string, LoadedModel>
  /** folder asal (untuk ditampilkan) */
  dir: string
  loadedAt: number
}

export interface ModelOutput {
  name: string
  kind: string
  theta: number
  hard: boolean
  p: [number, number, number]
  signal: -1 | 0 | 1
  /** false = fitur untuk model ini belum lengkap (mis. GRU butuh 60 baris) */
  available: boolean
}
