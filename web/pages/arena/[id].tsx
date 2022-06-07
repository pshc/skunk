import type { GetServerSideProps, NextPage } from 'next'
import Head from 'next/head'
import styles from '../../styles/Arena.module.css'
import { arenaStats } from '../api/arena/[id]'

const Arena: NextPage<Props> = (props) => {
  return (
    <div className={styles.container}>
      <Head>
        <title>arena</title>
        <meta name="description" content="skunk arena stats" />
      </Head>

      <main className={styles.main}>
        <h1>Arena stats</h1>
        <p>{props.content}</p>
        <a href={props.csv}>2d100.csv</a>
      </main>
    </div>
  )
}

interface Props {
  id: string,
  content: string,
  csv: string,
}

export const getServerSideProps: GetServerSideProps<Props> = async ({ query }) => {
  const { id } = query
  // single hardcoded arena for now
  if (id !== '2') {
    return { notFound: true }
  }
  // fetch stats directly server-side, for now
  // (alternatively, we could hit `api/arena/2` client-side)
  const { content } = await arenaStats(id)

  const csv = `../rolls/arena:${id}_2d100.csv`
  const props: Props = { id, content, csv }
  return { props }
}

export default Arena
