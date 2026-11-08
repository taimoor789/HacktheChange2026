// OWNER B: app router.
// Responsible for: mapping routes to screens.
// TODO(OWNER B): add transitions and route guards (e.g. redirect to /lobby with no match).
import { Link, Route, Routes } from 'react-router-dom';
import { Lobby } from './screens/Lobby';
import { CharacterSelect } from './screens/CharacterSelect';
import { Battle } from './screens/Battle';
import { PostMatchReview } from './screens/PostMatchReview';
import { Profile } from './screens/Profile';

export function App() {
  return (
    <>
      <nav style={{ display: 'flex', gap: 12, padding: 8 }}>
        <Link to="/">Lobby</Link>
        <Link to="/character">Character</Link>
        <Link to="/battle">Battle</Link>
        <Link to="/review">Review</Link>
        <Link to="/profile">Profile</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Lobby />} />
        <Route path="/character" element={<CharacterSelect />} />
        <Route path="/battle" element={<Battle />} />
        <Route path="/review" element={<PostMatchReview />} />
        <Route path="/profile" element={<Profile />} />
      </Routes>
    </>
  );
}
