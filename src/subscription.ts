import { Database } from './db'
import {
  OutputSchema as RepoEvent,
  isCommit,
} from './lexicon/types/com/atproto/sync/subscribeRepos'
import { ListManager } from './list'
import {
  FirehoseSubscriptionBase,
  getOpsByType,
  Operations,
} from './util/subscription'
import { Record as PostRecord } from './lexicon/types/app/bsky/feed/post'
import { Record as RepostRecord } from './lexicon/types/app/bsky/feed/repost'
import { Record as LikeRecord } from './lexicon/types/app/bsky/feed/like'
import { Record as FollowRecord } from './lexicon/types/app/bsky/graph/follow'

export class FirehoseSubscription extends FirehoseSubscriptionBase {
  listManager: ListManager
  listUserDids: string[]

  constructor(db: Database, service: string, listManager: ListManager) {
    super(db, service)
    this.listManager = listManager
  }

  async handleEvent(evt: RepoEvent) {
    if (!isCommit(evt)) return

    const ops = await getOpsByType(evt)

    this.listUserDids = await this.listManager.getListUserDids()
    this.processPosts(ops.posts)
  }

  async processPosts(posts: Operations<PostRecord>) {
    const postsToDelete = posts.deletes.map((del) => del.uri)
    const postsToCreate = posts.creates
      .filter((create) => {
        // only trans-related posts
        return (
          create.record.langs?.includes('en') &&
          ((create.record.text
            .toLowerCase()
            .match(/\btrans(gender|sexual|masc|fem(me)?)?s?\b/g)?.length || 0) >
            0 ||
            this.listUserDids.includes(create.author))
        )
      })
      .map((create) => {
        // map trans-related posts to a db row
        console.log('<>\n', create.record.text, '\n</>')
        return {
          uri: create.uri,
          cid: create.cid,
          indexedAt: new Date().toISOString(),
          likes: 0,
          reposts: 0,
        }
      })

    if (postsToDelete.length > 0) {
      await this.db
        .deleteFrom('post')
        .where('uri', 'in', postsToDelete)
        .execute()
    }
    if (postsToCreate.length > 0) {
      await this.db
        .insertInto('post')
        .values(postsToCreate)
        .onConflict((oc) => oc.doNothing())
        .execute()
    }
  }

  async processReposts(reposts: Operations<RepostRecord>) {}

  async processLikes(reposts: Operations<LikeRecord>) {}

  async processFollows(reposts: Operations<FollowRecord>) {}
}
