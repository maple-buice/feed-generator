import { ListPurpose } from '../lexicon/types/app/bsky/graph/defs'

export type DatabaseSchema = {
  post: Post
  sub_state: SubState
  list: List
  list_user: ListUser
}

export type Post = {
  uri: string
  cid: string
  indexedAt: string
}

export type SubState = {
  service: string
  cursor: number
}

export type List = {
  uri: string
  cid: string
  name: string
  purpose: ListPurpose
  indexedAt?: string
}

export type ListUser = {
  listUri: string
  did: string
  handle: string
  displayName?: string
  description?: string
  avatar?: string
  indexedAt: string
  createdAt: string
}
