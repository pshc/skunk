import type { NextPage } from 'next'
import Head from 'next/head'
import styles from '../styles/Home.module.css'

const Home: NextPage = () => {
  return (
    <div className={styles.container}>
      <Head>
        <title>skunkweb</title>
        <meta name="description" content="skunk web app" />
      </Head>

      <main className={styles.main}>
        <h1>skunk</h1>
      </main>
    </div>
  )
}

export default Home
