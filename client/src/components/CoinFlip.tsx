import { useEffect, useState } from 'react';
import './CoinFlip.css';

type Props = {
  winnerName: string;
  winnerSide: 'L' | 'R';
};

export default function CoinFlip({ winnerName, winnerSide }: Props) {
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setRevealed(true), 2550);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="coinOverlay" role="status" aria-live="polite">
      <div className="coinScene">
        <div className={`coin final-${winnerSide.toLowerCase()}`}>
          <div className="coinFace coinFront">L</div>
          <div className="coinFace coinBack">R</div>
        </div>
      </div>

      <div className={`coinText ${revealed ? 'visible' : ''}`}>
        <span>МОНЕТКА РЕШАЕТ</span>
        <b>{winnerSide} · {winnerName}</b>
        <small>первый ход veto</small>
      </div>
    </div>
  );
}
