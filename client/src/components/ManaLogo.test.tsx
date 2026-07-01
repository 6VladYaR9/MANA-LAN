import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ManaLogo from './ManaLogo';

describe('ManaLogo', () => {
  it('renders the full image logo with accessible text', () => {
    render(<ManaLogo />);

    const image = screen.getByAltText('MANA центр киберспорта');
    expect(image).toHaveAttribute('src', '/assets/mana-logo.png');
    expect(screen.getByLabelText('MANA центр киберспорта')).toBeInTheDocument();
  });

  it('renders the compact wordmark', () => {
    render(<ManaLogo variant="compact" />);

    expect(screen.getByLabelText('MANA')).toHaveTextContent('MANA');
  });
});
