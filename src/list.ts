import AtpAgent, { Agent, BskyAgent, CredentialSession } from '@atproto/api'
import { Database } from './db'
import { List, ListUser } from './db/schema'
import { sql } from 'kysely'
import { CacheContainer } from 'node-ts-cache'
import { MemoryStorage } from 'node-ts-cache-storage-memory'
import { Server } from './lexicon'
import { AppContext, Config } from './config'

const listUserDidCache = new CacheContainer(new MemoryStorage())

export class ListManager {
  _agent: BskyAgent
  _lists: string[] = ['3lcny577bu52o']

  constructor(public db: Database, public service: string, public cfg: Config) {
    this._agent = new BskyAgent({ service: this.service })
  }

  async authorIsListUser(author: string): Promise<boolean> {
    return (await this.getListUserDids()).includes(author)
  }

  async getListUserDids(): Promise<string[]> {
    const cachedDids = await listUserDidCache.getItem<string[]>('userDids')

    if (cachedDids) {
      return cachedDids
    }

    await this.refreshListUserDidCache()

    return this.getListUserDids()
  }

  async run(listUpdateDelay: number) {
    await this._agent.login({
      identifier: this.cfg.agentHandle,
      password: this.cfg.agentAppPassword,
    })

    let lists: List[] = []
    let users: ListUser[] = []
    for (let list of this._lists) {
      let listUri = this.getListUri(list)
      lists.push(await this.getList(listUri))
      users = users.concat(await this.getListUsers(listUri))
    }

    let listsToAdd = await this.getListsToAdd(lists)
    let listsToDelete = await this.getListsToDelete(lists)
    if (listsToAdd.length > 0) {
      await this.db.insertInto('list').values(listsToAdd).execute()
    }
    if (listsToDelete.length > 0) {
      await this.db
        .deleteFrom('list')
        .where('uri', 'in', listsToDelete)
        .execute()
    }

    let listUsersToAdd = await this.getListUsersToAdd(users)
    let listsUsersToDelete = await this.getListUsersToDelete(users)
    if (listUsersToAdd.length > 0) {
      await this.db.insertInto('list_user').values(listUsersToAdd).execute()
    }
    if (listsUsersToDelete.length > 0) {
      await this.db
        .deleteFrom('list_user')
        .where(
          sql<string>`concat('listUri', ':', 'did')`,
          'in',
          listsUsersToDelete,
        )
        .execute()
    }

    await this.refreshListUserDidCache()

    setTimeout(() => this.run(listUpdateDelay), listUpdateDelay)
  }

  getListUri(list: string): string {
    return 'at://' + this.cfg.publisherDid + '/app.bsky.graph.list/' + list
  }

  async getList(listUri: string): Promise<List> {
    let cursor: string | undefined

    let res = await this._agent.app.bsky.graph.getList({
      list: listUri,
      limit: 1,
      cursor,
    })

    return <List>{
      uri: listUri,
      cid: res.data.list.cid,
      name: res.data.list.name,
      purpose: res.data.list.purpose,
      indexedAt: res.data.list.indexedAt || new Date().toISOString(),
    }
  }

  async getListUsers(listUri: string): Promise<ListUser[]> {
    let cursor: string | undefined
    let users: ListUser[] = []

    do {
      let res = await this._agent.app.bsky.graph.getList({
        list: listUri,
        limit: 30,
        cursor,
      })
      cursor = res.data.cursor

      users = users.concat(
        res.data.items.map((item) => {
          return <ListUser>{
            listUri: listUri,
            did: item.subject.did,
            handle: item.subject.handle,
            displayName: item.subject.displayName,
            description: item.subject.description,
            indexedAt: item.indexedAt || new Date().toISOString(),
            createdAt: item.createdAt || new Date().toISOString(),
          }
        }),
      )
    } while (cursor)

    return users
  }

  async getListsToAdd(fetchedLists: List[]): Promise<List[]> {
    let existingListUris = (
      await this.db.selectFrom('list').select('uri').execute()
    ).map((list) => list.uri)
    return fetchedLists.filter((list) => !existingListUris.includes(list.uri))
  }

  async getListsToDelete(fetchedLists: List[]): Promise<string[]> {
    let fetchedKeys = fetchedLists.map((list) => list.uri)
    return (
      await this.db
        .selectFrom('list')
        .where(sql<string>`uri`, 'not in', fetchedKeys)
        .select([`uri`])
        .execute()
    ).map((list) => list.uri)
  }

  async getListUsersToAdd(fetchedUsers: ListUser[]): Promise<ListUser[]> {
    let existingUserKeys = (
      await this.db
        .selectFrom('list_user')
        .select([sql<string>`concat(listUri, ':', did)`.as('key')])
        .execute()
    ).map((listUser) => listUser.key)
    return fetchedUsers.filter(
      (user) => !existingUserKeys.includes(user.listUri + ':' + user.did),
    )
  }

  async getListUsersToDelete(fetchedUsers: ListUser[]): Promise<string[]> {
    let fetchedKeys = fetchedUsers.map((user) => user.listUri + ':' + user.did)
    return (
      await this.db
        .selectFrom('list_user')
        .select(sql<string>`concat(listUri, ':', did)`.as('key'))
        .where(sql<string>`concat(listUri, ':', did)`, 'not in', fetchedKeys)
        .execute()
    ).map((listUser) => listUser.key)
  }

  async refreshListUserDidCache() {
    await listUserDidCache.setItem('userDids', this.getListUserDidsFromDb(), {
      isCachedForever: true, // will manually evict when refresh runs
    })
  }

  async getListUserDidsFromDb(): Promise<string[]> {
    return (
      await this.db.selectFrom('list_user').select(['did']).execute()
    ).map((listUser) => listUser.did)
  }
}
