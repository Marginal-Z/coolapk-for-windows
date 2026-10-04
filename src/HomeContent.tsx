import { useMemo, useRef } from 'react';
import { ArrowLeft, ArrowRight, ChevronRight, Hash } from 'lucide-react';
import { EntityCard, FeedCard, Picture } from './components';
import { count, plain } from './data';
import { homeSurfaceSections, surfaceItemKey } from '../core/home-surface.mjs';
import { isFeedEntity } from './Community';
import type { Entity } from './types';
import './home-content.css';

type Props = { items: Entity[]; visibleFeed?: (feed: Entity) => boolean; openEntity: (entity: Entity) => void; feedProps: any };
type Section = { item: Entity; children?: Section[] };
function NavigationTile({ item, openEntity, banner = false }: { item: Entity; openEntity: Props['openEntity']; banner?: boolean }) {
  const title = plain(item.title || item.username || item.message_title || '查看内容');
  return <button className={banner ? 'home-banner' : 'home-shortcut'} onClick={() => openEntity(item)}>
    {item.pic || item.logo || item.cover ? <Picture src={item.pic || item.logo || item.cover} alt="" /> : <Hash size={22} aria-hidden="true" />}
    <span>{title}</span>
  </button>;
}
function SurfaceSection({ section, openEntity, feedProps }: { section: Section; openEntity: Props['openEntity']; feedProps: any }) {
  const rail = useRef<HTMLDivElement>(null), { item, children } = section;
  const title = plain(item.title || '');
  const type = String(item.entityTemplate || '');
  const carousel = type.startsWith('imageCarouselCard');
  const shortcuts = type === 'iconLinkGridCard';
  const interest = type === 'iconMiniScrollCard' || type === 'selectorLinkCard';
  const tileImages = carousel || shortcuts || /^image(?:SquareScroll|Scale)Card/.test(type);
  if (item.entityType === 'phoneUpdates') return <section className="home-section home-phone-updates"><div><h2>手机应用更新</h2><p className="muted">在手机协同窗口中查看已安装应用的更新。</p></div><button className="button secondary" onClick={() => openEntity(item)}>查看手机应用更新<ChevronRight size={16} /></button></section>;
  if (type === 'unLoginCard') return <section className="home-section"><h2>{title || '关注感兴趣的内容'}</h2><p className="muted">{plain(item.description || item.subTitle || '登录后查看你的关注动态。')}</p><button className="button" onClick={feedProps.onLogin}>登录酷安</button></section>;
  if (type === 'titleCard' || type === 'textCard') return <section className="home-section home-text-section"><div className="home-section-heading"><h2>{title}</h2>{item.url && <button className="text-button" onClick={() => openEntity(item)}>查看全部<ChevronRight size={16} /></button>}</div>{item.description && <p>{plain(item.description)}</p>}</section>;
  if (type === 'productTimelineListCard' && children) return <section className="home-section"><div className="home-section-heading"><h2>{title || '发布日历'}</h2>{item.url && <button className="text-button" onClick={() => openEntity(item)}>查看全部<ChevronRight size={16} /></button>}</div><div className="home-timeline">{children.map(({ item: product }) => <button key={surfaceItemKey(product)} className="home-timeline-row" onClick={() => openEntity(product)}><span className="home-release-date">{plain(product.release_time || '日期待定')}</span><Picture src={product.logo || product.pic || product.cover || ''} alt="" /><strong>{plain(product.title)}</strong>{product.hot_num != null && <small>{count(product.hot_num)} 热度</small>}</button>)}</div></section>;
  if (!children) return <div className="home-single-item">{isFeedEntity(item) ? <FeedCard feed={item} {...feedProps} /> : <EntityCard entity={item} onOpen={openEntity} onUser={feedProps.onUser} onLink={feedProps.onLink} />}</div>;
  return <section className={`home-section${carousel ? ' home-carousel' : ''}${shortcuts ? ' home-shortcuts-section' : ''}`} aria-label={title || (carousel ? '首页活动' : shortcuts ? '首页快捷入口' : interest ? '话题与机型推荐' : '首页内容分组')}>
    {(title || item.url && !interest || carousel) && <div className="home-section-heading">
      {title && <h2>{title}</h2>}
      {item.url && !interest && <button className="text-button" onClick={() => openEntity(item)}>查看全部<ChevronRight size={16} /></button>}
      {carousel && <div className="home-carousel-controls"><button className="icon-button" aria-label="上一组活动" onClick={() => rail.current?.scrollBy({ left: -rail.current.clientWidth })}><ArrowLeft size={17} /></button><button className="icon-button" aria-label="下一组活动" onClick={() => rail.current?.scrollBy({ left: rail.current.clientWidth })}><ArrowRight size={17} /></button></div>}
    </div>}
    <div ref={rail} className={carousel ? 'home-banner-rail' : shortcuts ? 'home-shortcuts' : interest ? 'home-interest-grid' : tileImages ? 'home-image-grid' : 'home-group-grid'}>
      {children.map(child => tileImages && !child.children ? <NavigationTile key={surfaceItemKey(child.item)} item={child.item} openEntity={openEntity} banner={carousel || !shortcuts} /> : interest && !child.children ? <button className="home-interest" key={surfaceItemKey(child.item)} onClick={() => openEntity(child.item)}>{child.item.pic || child.item.logo ? <Picture src={child.item.pic || child.item.logo} alt="" /> : <Hash size={15} aria-hidden="true" />}<span>{plain(child.item.title)}</span></button> : <SurfaceSection key={surfaceItemKey(child.item)} section={child} openEntity={openEntity} feedProps={feedProps} />)}
    </div>
  </section>;
}
export function HomeContent({ items, visibleFeed, openEntity, feedProps }: Props) {
  const sections: Section[] = useMemo(() => homeSurfaceSections(items, { visibleFeed }), [items, visibleFeed]);
  return <div className="home-content feed-list">{sections.map(section => <SurfaceSection key={surfaceItemKey(section.item)} section={section} openEntity={openEntity} feedProps={feedProps} />)}</div>;
}
