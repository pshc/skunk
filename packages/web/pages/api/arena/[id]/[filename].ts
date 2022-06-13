import type { NextApiHandler } from 'next'
import { promises, createReadStream, Stats } from 'fs'

const handler: NextApiHandler = async (req, res) => {
  const { id, filename } = req.query
  // hardcoded arena id
  if (id !== '2') {
    return res.status(404).end()
  }

  if (typeof filename !== 'string') {
    throw new Error('expected one filename')
  }
  // only allow specific filenames
  if (!/^\dd100.csv$/.test(filename)) {
    return res.status(404).end()
  }
  // careful, no escaping here
  const csv = `../../rolls/arena:${id}_${filename}`

  let stat: Stats
  try {
    stat = await promises.stat(csv)
  } catch (e: any) {

    if (e.code === 'ENOENT') {
      return res.status(404).end('CSV does not exist')
    } else {
      throw e
    }
  }
  // race condition between stat above and read below
  // ideally we would snapshot the CSV first?
  res.writeHead(200, {
    'Content-Type': 'text/csv',
    'Content-Length': stat.size,
  })
  createReadStream(csv).pipe(res)
}
export default handler
