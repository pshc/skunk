import type { GetStaticProps, NextPage } from 'next'
import Head from 'next/head'
import Link from 'next/link'
import styles from '../styles/Home.module.css'

const Home: NextPage<Props> = ({ arena }) => {
  const arenaHref = `arena/${encodeURIComponent(arena)}`;
  return (
    <div className={styles.container}>
      <Head>
        <title>elua.xyz</title>
        <meta name="description" content="stat tracker for an idle game" />
      </Head>

      <main className={styles.main}>
        <h1 className={styles.elua}>elua.xyz</h1>
        <Link href={arenaHref}>Enter the Arena</Link>
        <article className={styles.moloch}>
          <p>What sphinx of cement and aluminum bashed open their skulls and ate up their brains and imagination?</p>
          <p>Moloch! Solitude! Filth! Ugliness! Ashcans and unobtainable dollars! Children screaming under the stairways! Boys sobbing in armies! Old men weeping in the parks!</p>
          <p>Moloch! Moloch! Nightmare of Moloch! Moloch the loveless! Mental Moloch! Moloch the heavy judger of men!</p>
          <p>Moloch the incomprehensible prison! Moloch the crossbone soulless jailhouse and Congress of sorrows! Moloch whose buildings are judgment! Moloch the vast stone of war! Moloch the stunned governments!</p>
          <p>Moloch whose mind is pure machinery! Moloch whose blood is running money! Moloch whose fingers are ten armies! Moloch whose breast is a cannibal dynamo! Moloch whose ear is a smoking tomb!</p>
          <p>Moloch whose eyes are a thousand blind windows! Moloch whose skyscrapers stand in the long streets like endless Jehovahs! Moloch whose factories dream and croak in the fog! Moloch whose smoke-stacks and antennae crown the cities!</p>
          <p>Moloch whose love is endless oil and stone! Moloch whose soul is electricity and banks! Moloch whose poverty is the specter of genius! Moloch whose fate is a cloud of sexless hydrogen! Moloch whose name is the Mind!</p>
          <p>Moloch in whom I sit lonely! Moloch in whom I dream Angels! Crazy in Moloch! Cocksucker in Moloch! Lacklove and manless in Moloch!</p>
          <p>Moloch who entered my soul early! Moloch in whom I am a consciousness without a body! Moloch who frightened me out of my natural ecstasy! Moloch whom I abandon! Wake up in Moloch! Light streaming out of the sky!</p>
          <p>Moloch! Moloch! Robot apartments! invisible suburbs! skeleton treasuries! blind capitals! demonic industries! spectral nations! invincible madhouses! granite cocks! monstrous bombs!</p>
          <p>They broke their backs lifting Moloch to Heaven! Pavements, trees, radios, tons! lifting the city to Heaven which exists and is everywhere about us!</p>
          <p>Visions! omens! hallucinations! miracles! ecstasies! gone down the American river!</p>
          <p>Dreams! adorations! illuminations! religions! the whole boatload of sensitive bullshit!</p>
          <p>Breakthroughs! over the river! flips and crucifixions! gone down the flood! Highs! Epiphanies! Despairs! Ten years&rsquo; animal screams and suicides! Minds! New loves! Mad generation! down on the rocks of Time!</p>
          <p>Real holy laughter in the river! They saw it all! the wild eyes! the holy yells! They bade farewell! They jumped off the roof! to solitude! waving! carrying flowers! Down to the river! into the street!</p>
        </article>
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
