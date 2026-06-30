import './SideOperatives.css';

/**
 * Декоративные оперативники по бокам.
 * Компонент подключается только на MATCH BOOKING и MATCH ROOM.
 * SVG-заглушки можно заменить на PNG/WebP своих скинов в этом же компоненте.
 */
export default function SideOperatives() {
  return (
    <div className="sideOperatives" aria-hidden="true">
      <img className="sideOperative sideOperativeLeft" src="/assets/agents/operative-left.svg" alt="" />
      <img className="sideOperative sideOperativeRight" src="/assets/agents/operative-right.svg" alt="" />
    </div>
  );
}
