import './App.css'
import type { EventDto } from 'shared'

function App() {
  const heading: EventDto['name'] = 'Hello world'

  return (
    <>
      <h1 className='text-blue-300'>{heading}</h1>
    </>
  )
}

export default App
