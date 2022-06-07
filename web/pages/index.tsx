import type { GetStaticProps, NextPage } from 'next'
import Head from 'next/head'
import Link from 'next/link'
import styles from '../styles/Home.module.css'

const Home: NextPage<Props> = ({ arena }) => {
  const arenaHref = `arena/${encodeURIComponent(arena)}`;
  return (
    <div className={styles.container}>
      <Head>
        <title>skunkweb</title>
        <meta name="description" content="skunk web app" />
      </Head>

      <main className={styles.main}>
        <h1>skunk</h1>
        <Link href={arenaHref}>Enter the Arena</Link>
      </main>
    </div>
  )
}

interface Props {
  arena: string,
}

// since we only have one hardcoded arena, we can use static props here
export const getStaticProps: GetStaticProps = async () => {
  const props = { arena: '2' }
  return { props }
}

export default Home
