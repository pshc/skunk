// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiHandler } from 'next'

import { redis } from '#burrow/db'
import { dayRollKey } from '#burrow/dice'

type Data = {
  content: string
}

const handler: NextApiHandler<Data> = async (req, res) => {
  const { id } = req.query
  // hardcoded
  if (id !== '2') {
    return res.status(404).end()
  }
  const json = await arenaStats(id)
  res.status(200).json(json)
}
export default handler

export async function arenaStats(id: string) {
  const arena = `arena:${id}`

  const yesterday = dayRollKey(arena, 'yesterday')
  const champ = await redis.get(`${yesterday}:name`) || '<nobody>'
  const brick = await redis.get(`${yesterday}:low_name`) || '<nobody>'

  return { content: `champ: ${champ}, brick: ${brick}` }
}
