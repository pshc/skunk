// Next.js API route support: https://nextjs.org/docs/api-routes/introduction
import type { NextApiHandler } from 'next'

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
  return { content: `(pull stats from arena #${id})` }
}
