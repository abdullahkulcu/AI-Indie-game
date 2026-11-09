"use client";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import KingdomScene from "./KingdomScene";
import ChannelWorldMap from "./ChannelWorldMap";
import RichMessage from "./RichMessage";
import AccountGate, { type Account } from "./AccountGate";
import GameIcon, { type GameIconName } from "./GameIcon";
import MarketWorkspace from "./MarketWorkspace";
import WarCampaignWorkspace, { type CampaignDraft } from "./WarCampaignWorkspace";
// Halkın meclise araya girmesinin eşiği, tekrar freni ve General'e gönderilen
// sohbet geçmişinin süzgeci SAF bir modülde yaşar ve testlidir
// (tests/populace-interjection.test.ts). Buradaki JSX test edilemez; o kural
// edilebilir olmalı, çünkü yanlış kurulduğunda General halkın şikâyetini
// kendi sözü sanır.
import { generalHistory, interjectionKey, interjectionSpeaker, pickInterjections, type ChatLine, type InterjectionDemand } from "./populace-interjection";
import { applyActions, marketState } from "@/engine/actions";
import type { TradeKey } from "@/engine/market";
import { catalog, MAX_BUILDING_LEVEL, resourceLabels, terrainCatalog } from "@/engine/catalog";
import { buildOptions, keep, materialScaleOf, rates, servedRations, tick } from "@/engine/tick";
import { constructionSlots } from "@/engine/construction";
import { foundKingdom } from "@/engine/founding";
import { garrisonMood, garrisonVetoes } from "@/engine/populace-voice";
import { factionLeaderName, factionPressureOf, factionState, FACTION_THRESHOLDS } from "@/engine/faction";
import { lureAt, MOVEMENT_SUPPORT } from "@/engine/agitation";
import { SPY_NETWORK } from "@/engine/intelligence";
import { worldEventStatusAt, worldEventSummary } from "@/engine/world-events";
// Zafer skorunun formülü, satır etiketleri ve doktrin okunuşu motorda yaşar
// (engine/victory.ts). Panel hiçbir katsayıyı elle tekrar yazmaz; skoru CANLI
// oyun durumu ile sunucudan gelen kese defterinden aynı fonksiyonla hesaplar.
import { victoryScore, type VictoryPurse } from "@/engine/victory";
// Kıyasın sözlüğü motordan gelir: hangi ölçütler, her ölçütte "iyi" hangi yön
// (yüksek vergi KÖTÜ) ve ortalamanın açıklanabilmesi için gereken en az sancak
// sayısı. Panel bunları elle tekrar yazmaz.
import { COMPARE_METRICS, COMPARE_MIN_SAMPLE, compareValuesOf, compareVerdict, type CompareMetric } from "@/engine/comparison";
import { generalNameFor } from "@/engine/general-name";
import { armySize, hourlyDemand, moodState, NEED, populationChange, rationsOf, suppression } from "@/engine/populace";
import { defenseOf, watchRatioOf } from "@/engine/raids";
import { armyExperience, armyManpower, armyUpkeep, experienceOf, isTrainableUnit, unitCatalog, unitCostFor } from "@/engine/units";
import { applyPolicy, clampPolicy, type PolicyKey } from "@/engine/policy";
// Müzakere sınırları TEK kaynaktan gelir. Panelde elle yazılan bir tavan,
// sunucunun uyguladığı tavandan sapınca Kral reddedilecek bir şart öneriyor.
import { MAX_HOURS, MAX_MESSAGE_LENGTH, MAX_MERCENARY_COUNT, MAX_MERCENARY_FEE, MAX_TRIBUTE_AMOUNT, MAX_TRIBUTE_RATE_PERCENT, TRIBUTE_RESOURCES, canProposeTerms, canSpeak, carriesTribute, tributeRateFromPercent, type Negotiation, type NegotiationStatus, type NegotiationTopic, type Side, type Terms } from "@/engine/negotiation";
import type { Game, GameAction, TerrainId as EngineTerrainId } from "@/engine/types";
import type { CouncilConnection, CouncilVoice } from "@/server/council-advisors";
import type { CouncilBriefing, CouncilMeeting } from "@/server/council-briefing";


type Tab="meclis"|"general"|"defter"|"binalar"|"halk"|"pazar"|"ordu"|"sefer"|"istihbarat"|"diyar"|"iliskiler"|"muzakere"; type Setup="welcome"|"channel"|"kingdom"|"general";
type MainSection="divan"|"krallik"|"savas"|"diyar";
type GeneralAction=GameAction;
type GeneralRequest={id:string;kind:string;text:string;severity:"normal"|"urgent";since:number};
type PeoplePulse={label:string;note:string;riskLevel:"elevated"|"severe"};
type PopulaceFeedItem={id:string;kind:string;text:string;createdAt:number};
type CoalitionDemand={id:string;kind:"tax_relief"|"food_relief";text:string;policyKey:"taxRate"|"foodRation";policyValue:number;openedAt:number;refusalCount:number};
type ReferendumResult={id:string;topic:"tax_increase"|"tax_relief"|"food_cut"|"food_relief";question:string;support:number;verdict:"supported"|"divided"|"opposed";text:string;askedAt:number};
type FateEvent={id:string;kind:"defiant_opposition"|"empty_tables"|"garrison_breaking";title:string;text:string;discussion:string;status:"open";openedAt:number};
// Halkın sesi sunucudan gelir: süre şartının defteri (koşul kaç oyun saatidir
// sürüyor) sunucudadır, çünkü Kral kendi halkının talebini silememeli.
// Tipin TEK kaynağı artık `components/populace-interjection.ts`: balon eşiği o
// tipin alanlarını (severity, since) okuyor, panel kendi kopyasını tutmaz.
type PopulaceDemand=InterjectionDemand;
type CouncilResponse={briefing?:CouncilBriefing|null;meetings?:CouncilMeeting[];scheduledAt?:number;alreadyScheduled?:boolean;error?:string};
// Dış kese: bedel ve tavan motordan gelir, panel kendi kopyasını tutmaz.
// Gelen faaliyetler kapatılamaz; savunma karşı-istihbarat üzerinden yürür.
type AgitationStatus={cost:number;sentToday:number;perDay:number};
/** GET /api/world → `victory`. Skor burada DEĞİL motorda hesaplanır; sunucu
 *  yalnızca kendi kese defterimizi ve (gizlilik alt sınırı sağlanıyorsa)
 *  sıramızı gönderir — komşunun skoru ve kimliği inmez. */
type VictoryStanding={purses:VictoryPurse[];caught:number;rank:number|null;ranked:number};
// Channel kıyası: SUNUCUDAN yalnızca ortalama iner (server/world-projection.ts →
// channelAverages). Kimin hangi değere sahip olduğu hiç gelmez; aday sayısı
// gizlilik alt sınırının altındaysa `averages` bile null gelir.
type ChannelCompare={counted:number;protectedOut:number;averages:Record<CompareMetric,number>|null};
// Channel pazar endeksi (plan belgesi Fikir 24): mal başına tek bir fiyat
// çarpanı. SUNUCUDAN iner (app/api/world → channelPriceIndex) ve kaydın içinde
// DURMAZ — istemcinin bildirebileceği bir alan olsaydı Kral endeksi kendi
// lehine yazıp fiyatı kırardı (bkz. server/save-validation.ts, "HALKIN DEFTERİ
// SUNUCUNUN"). Gizlilik alt sınırının altında null gelir; o zaman endeks nötrdür.
type ChannelIndex=Partial<Record<TradeKey,number>>;
// Kıyas satırlarının Türkçe başlıkları. Ölçüt listesi ve yön motorda; burada
// yalnızca sözcükler var. `Record` tipi yeni bir ölçüt eklendiğinde bu haritayı
// derleme hatasıyla zorlar, satır sessizce eksik kalmaz.
const compareLabels:Record<CompareMetric,{name:string;percent:boolean}>={popularity:{name:"Rıza",percent:false},foodRation:{name:"Yiyecek istihkakı",percent:true},taxRate:{name:"Vergi oranı",percent:true},factionPressure:{name:"Muhalefet baskısı",percent:false}};
const compareText=(metric:CompareMetric,value:number)=>compareLabels[metric].percent?`%${value}`:`${value}`;
type Channel={id:string;name:string;detail:string;speed:number;remaining:string;players?:number;maxPlayers?:number;durationDays?:number};
// Ajan raporunun içeriği SUNUCUDA kararlaşır (server/world-projection.ts →
// intelReportOf). Ambar burada yoktu ama sunucudan iniyordu; artık hiç gelmiyor.
type IntelReport={name:string;ruler:string;terrain:string;keepLevel:number;population:number;buildingCount:number;army:number;populaceMood?:string};
type WorldKingdom={id:string;name:string|null;terrain:string;position:{x:number;z:number};ring:number;discovered:boolean;mission:{status:"pending"|"succeeded"|"failed"|"detected";completesAt:number;successChance:number;kind?:"scout"|"deep_observation"}|null;network?:{status:"deploying"|"active"|"exposed"|"recalled";deploysAt:number;nextReportAt:number|null;exposedAt:number|null}|null;report:IntelReport|null;reportAt?:number|null;reportStale?:boolean;relation?:number};
type NegotiationTable={id:string;topic:string;status:string;turns:number;side:"initiator"|"target";counterpartId:string;counterpart:string;proposed:{topic:string;resource?:string;tributeAmount?:number;tributeRate?:number;hours?:number;everyHours?:number;mercenaryCount?:number;mercenaryFee?:number;lessorSide?:"initiator"|"target"}|null;proposedBy:string|null;canAccept:boolean;expiresAt:number;messages:Array<{mine:boolean;speaker:string;body:string;at:number}>};
type Agreement={id:string;topic:string;terms:{resource?:string;tributeAmount?:number;tributeRate?:number;hours?:number;everyHours?:number;mercenaryCount?:number;mercenaryFee?:number;lessorSide?:"initiator"|"target"};iPay:boolean;counterpartId:string;counterpart:string;endsAt:number;paidCount:number;everyHours:number};
type SharedMine={personalCap?:number;channelSlots?:number;orePerWorkerHour?:number;renewal?:{previousName:string;nextName:string;message:string}|null;influence?:{ownerId:string|null;ownerName:string|null;gameHours:number;windowHours:number};mine:{id:string;name:string;vein?:number;oreRemaining:number;extractedOre:number;totalWorkers:number;position:{x:number;z:number}};participants:Array<{id:string;name:string;workers:number;deliveredOre?:number;self:boolean}>};
type TerrainId=EngineTerrainId;
// Yerel yedek hesap kimliğine göre ayrılır. Ortak bir anahtar kullanıldığında aynı
// tarayıcıda açılan yeni hesap, önceki hesabın krallığını devralıp buluta yazıyordu.
const LEGACY_STORE="demirkale.game.v2";
const storeKey=(accountId:string)=>`${LEGACY_STORE}:${accountId}`;
const modelOptions={
 openai:[{id:"gpt-5.6-terra",label:"GPT-5.6 Terra — Dengeli (önerilen)"},{id:"gpt-5.6-sol",label:"GPT-5.6 Sol — En güçlü"},{id:"gpt-5.6-luna",label:"GPT-5.6 Luna — Hızlı ve ekonomik"},{id:"gpt-5.5",label:"GPT-5.5 — Güçlü"},{id:"gpt-5.4-mini",label:"GPT-5.4 mini — Ekonomik"}],
 anthropic:[{id:"claude-sonnet-5",label:"Claude Sonnet 5 — Dengeli (önerilen)"},{id:"claude-opus-5",label:"Claude Opus 5 — En güçlü"},{id:"claude-fable-5",label:"Claude Fable 5 — Uzun görevler"},{id:"claude-haiku-4-5",label:"Claude Haiku 4.5 — Hızlı ve ekonomik"}]
} as const;
const fallbackChannels:Channel[]=[{id:"standard",name:"Standart Sezon III",detail:"84 gün · ×1 tempo · 0/300 Kral",speed:1,remaining:"84 gün"},{id:"frontier",name:"Sınır Boyu",detail:"28 gün · ×4 tempo · 0/120 Kral",speed:4,remaining:"28 gün"},{id:"rapid",name:"Hızlı Taç",detail:"7 gün · ×24 tempo · 0/80 Kral",speed:24,remaining:"7 gün"}];
const meta=resourceLabels;
const defaultAiConnections:CouncilConnection[]=[
 {role:"general",label:"General AI",state:"fallback",source:"rules"},
 {role:"commons",label:"Halk AI",state:"fallback",source:"rules"},
 {role:"garrison",label:"Garnizon AI",state:"fallback",source:"rules"},
];
const fmt=(n:number)=>new Intl.NumberFormat("tr-TR").format(Math.max(0,Math.round(n)));
const left=(at:number,now:number)=>{const s=Math.max(0,Math.ceil((at-now)/1000));return s>=3600?`${Math.floor(s/3600)}sa ${Math.floor(s%3600/60)}dk`:s>=60?`${Math.floor(s/60)}dk ${s%60}sn`:`${s}sn`};
const councilPast=(at:number,now:number)=>{const minutes=Math.max(0,Math.floor((now-at)/60_000));if(minutes<1)return "az önce";if(minutes<60)return `${minutes} dk önce`;const hours=Math.floor(minutes/60);return hours<24?`${hours} sa önce`:`${Math.floor(hours/24)} gün önce`};
const councilTime=(at:number)=>new Date(at).toLocaleString("tr-TR",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"});
function CouncilMeetingList({meetings,compact=false}:{meetings:CouncilMeeting[];compact?:boolean}){
 return <div className={`council-history-list${compact?" compact":""}`}>{meetings.map(meeting=>{const type=meeting.meetingType==="called"?"KRAL ÇAĞRISI":meeting.meetingType==="emergency"?"ACİL DİVAN":"OLAĞAN DİVAN";return <article key={meeting.id}><div><time>{councilTime(meeting.generatedAt)}</time><b>{meeting.sessionStage!=="concluded"?"OTURUM SÜRÜYOR":meeting.readAt?type:"AÇIK GÜNDEM"}</b></div><p>{meeting.outcome}</p><small>{meeting.voices.length?meeting.voices.map(voice=>`${voice.speaker}: ${voice.text}`).join(" · "):"Bu toplantıda AI görüşü kayda alınmadı."}</small>{meeting.discussion.length>0&&<details className="council-transcript-history"><summary>OTURUM TUTANAĞI · {meeting.discussion.length} SÖZ</summary>{meeting.discussion.map((line,index)=><p key={`${line.at}-${index}`}><b>{line.speaker}</b>{line.text}</p>)}</details>}</article>})}</div>;
}
const mainSections:Array<{id:MainSection;label:string;icon:GameIconName;first:Tab;tabs:Array<{id:Tab;label:string;icon?:GameIconName}>}>=[
 {id:"divan",label:"Divan",icon:"divan",first:"meclis",tabs:[{id:"meclis",label:"Meclis"},{id:"general",label:"General",icon:"general"},{id:"defter",label:"Defter"}]},
 {id:"krallik",label:"Krallık",icon:"krallik",first:"binalar",tabs:[{id:"binalar",label:"Binalar"},{id:"halk",label:"Halk"},{id:"pazar",label:"Pazar"}]},
 {id:"savas",label:"Savaş",icon:"savas",first:"ordu",tabs:[{id:"ordu",label:"Ordu"},{id:"sefer",label:"Sefer Masası"},{id:"istihbarat",label:"Dolaylı Mücadele",icon:"istihbarat"}]},
 {id:"diyar",label:"Diyar",icon:"diyar",first:"diyar",tabs:[{id:"diyar",label:"Harita"},{id:"iliskiler",label:"İlişkiler"},{id:"muzakere",label:"Müzakere"}]},
];
const sectionForTab=(tab:Tab)=>mainSections.find(section=>section.tabs.some(item=>item.id===tab))??mainSections[0];

export default function KingdomGame(){
 const[ready,setReady]=useState(false),[account,setAccount]=useState<Account|null|undefined>(undefined),[setup,setSetup]=useState<Setup>("welcome"),[availableChannels,setAvailableChannels]=useState<Channel[]>(fallbackChannels),[selected,setSelected]=useState<Channel>(fallbackChannels[2]);const[name,setName]=useState(""),[ruler,setRuler]=useState(""),[terrain,setTerrain]=useState<TerrainId>("plain"),[provider,setProvider]=useState<keyof typeof modelOptions>("openai"),[model,setModel]=useState("gpt-5.6-terra"),[apiKey,setApiKey]=useState("");
 const[game,setGame]=useState<Game|null>(null),[now,setNow]=useState(Date.now()),[tab,setTab]=useState<Tab>("meclis"),[night,setNight]=useState(false),[autoRotate,setAutoRotate]=useState(true),[marketOpen,setMarketOpen]=useState(false),[worldError,setWorldError]=useState<string|null>(null),[negotiationTables,setNegotiationTables]=useState<NegotiationTable[]>([]),[agreementList,setAgreementList]=useState<Agreement[]>([]),[negotiationOpen,setNegotiationOpen]=useState(false),[envoyTarget,setEnvoyTarget]=useState(""),[envoyTopic,setEnvoyTopic]=useState("non_aggression"),[envoyMessage,setEnvoyMessage]=useState(""),[envoyLimits,setEnvoyLimits]=useState({maxTurns:14,maxOpen:3}),[envoyAccepts,setEnvoyAccepts]=useState(true),[envoyTerm,setEnvoyTerm]=useState<{tableId:string;mode:"amount"|"rate";value:string;resource:string;payer:"us"|"them";lessor:"us"|"them";mercenaryCount:string;mercenaryFee:string;hours:string;everyHours:string;note:string}|null>(null),[kingReply,setKingReply]=useState<{tableId:string;text:string}|null>(null),[serverChannelId,setServerChannelId]=useState<string|null>(null),[worldView,setWorldView]=useState(false),[campaignTarget,setCampaignTarget]=useState<string|null>(null),[message,setMessage]=useState(""),[chat,setChat]=useState<ChatLine[]>([]),[toast,setToast]=useState(""),[connecting,setConnecting]=useState(false),[generalError,setGeneralError]=useState(""),[showConnect,setShowConnect]=useState(false),[tutorialStep,setTutorialStep]=useState<number|null>(null),[cloudReady,setCloudReady]=useState(false),[cloudStatus,setCloudStatus]=useState("BULUT ARANIYOR"),[cloudUser,setCloudUser]=useState(""),[storedByok,setStoredByok]=useState(false),[storedModel,setStoredModel]=useState(""),[storedProvider,setStoredProvider]=useState<keyof typeof modelOptions|"">(""),[replaceByok,setReplaceByok]=useState(false),[otherKingdoms,setOtherKingdoms]=useState<WorldKingdom[]>([]),[worldDefense,setWorldDefense]=useState<{active:boolean;activeUntil:number|null}>({active:false,activeUntil:null}),[incomingAlerts,setIncomingAlerts]=useState(0),[worldHome,setWorldHome]=useState<{x:number;z:number;ring:number;biome:string}>({x:0,z:0,ring:0,biome:"plain"}),[worldExtentValue,setWorldExtentValue]=useState(60),[sharedMine,setSharedMine]=useState<SharedMine|null>(null),[worldBusy,setWorldBusy]=useState(false),[generalRequests,setGeneralRequests]=useState<GeneralRequest[]>([]),[populaceDemands,setPopulaceDemands]=useState<PopulaceDemand[]>([]),[peoplePulse,setPeoplePulse]=useState<PeoplePulse|null>(null),[agitation,setAgitation]=useState<AgitationStatus>({cost:600,sentToday:0,perDay:4}),[channelCompare,setChannelCompare]=useState<ChannelCompare|null>(null),[victory,setVictory]=useState<VictoryStanding|null>(null),[channelIndex,setChannelIndex]=useState<ChannelIndex|null>(null),[infoPanel,setInfoPanel]=useState<"hedef"|"yetki"|null>(null);
 const [campaignDraft,setCampaignDraft]=useState<CampaignDraft|null>(null);
 const[panelOpen,setPanelOpen]=useState(false);
 const[selectedBuildingType,setSelectedBuildingType]=useState<string|null>(null);
 const[selectedNegotiationId,setSelectedNegotiationId]=useState<string|null>(null);
 const[indirectView,setIndirectView]=useState<"overview"|"political"|"intelligence">("overview");
 const[selectedOperation,setSelectedOperation]=useState<"gold_commons"|"support_movement"|"gold_garrison"|"goods_glut"|"raid_lure"|"scout"|"deep_scout"|"spy_network"|"defend"|null>(null);
 const[operationTarget,setOperationTarget]=useState("");
 const[operationResource,setOperationResource]=useState<TradeKey>("food");
 const[ledgerFilter,setLedgerFilter]=useState<"all"|"decision"|"economy"|"war"|"diplomacy"|"people">("all");
 const[aiConnections,setAiConnections]=useState<CouncilConnection[]>(defaultAiConnections),[populaceFeed,setPopulaceFeed]=useState<PopulaceFeedItem[]>([]),[coalitionDemand,setCoalitionDemand]=useState<CoalitionDemand|null>(null),[coalitionBusy,setCoalitionBusy]=useState(false),[referendum,setReferendum]=useState<ReferendumResult|null>(null),[fateEvent,setFateEvent]=useState<FateEvent|null>(null),[fateBusy,setFateBusy]=useState(false);
 const[councilVoices,setCouncilVoices]=useState<CouncilVoice[]>([]),[councilBriefing,setCouncilBriefing]=useState<CouncilBriefing|null>(null),[councilMeetings,setCouncilMeetings]=useState<CouncilMeeting[]>([]);
 const[councilBusy,setCouncilBusy]=useState(false),[councilError,setCouncilError]=useState("");
 const lastCloudSave=useRef(0),saving=useRef(false),revision=useRef<number|null>(null),worldRefresh=useRef<(()=>void)|null>(null),negotiationRefresh=useRef<(()=>void)|null>(null),lastEnvoySeen=useRef<number|null>(null),chatEnd=useRef<HTMLDivElement|null>(null);
 const lastCouncilLoaded=useRef(0);
 // Halkın meclise HANGİ talep için girdiği. Ref, state değil: bir daha
 // konuşmamayı sağlamak dışında hiçbir şeyi çizmez, çizimi eklenen balonun
 // kendisi yapar. Sayfa yenilenince sıfırlanır — sohbetin kendisi de kalıcı
 // olmadığı için (`chat` yalnızca istemci-içi) bu tutarlıdır: yeni bir sohbette
 // halk süregelen acil talebi için bir kez yeniden söz alır.
 const spokenInterjections=useRef<Set<string>>(new Set());
 // Yeni mesaj gelince sohbet dibe kaysın; uzun konuşmada son söz görünmez kalıyordu.
 useEffect(()=>{chatEnd.current?.scrollIntoView({behavior:"smooth",block:"end"})},[chat,connecting]);
 useEffect(()=>{if(!account)return;let active=true;void(async()=>{try{const response=await fetch("/api/council",{cache:"no-store"});const data=await response.json() as CouncilResponse;if(active&&response.ok){setCouncilMeetings(data.meetings??[]);if(data.briefing){setCouncilBriefing(data.briefing);setCouncilVoices(data.briefing.voices);setAiConnections(data.briefing.connections)}}}catch{/* Divan belgesi yoksa kartlar kural yedeğini gösterir. */}})();return()=>{active=false}},[account]);
 useEffect(()=>{if(!account)return;let active=true;void(async()=>{try{const response=await fetch("/api/populace-feed",{cache:"no-store"});const data=await response.json() as {items?:PopulaceFeedItem[]};if(active&&response.ok)setPopulaceFeed(data.items??[])}catch{/* Halk güncesi yoksa Halk sekmesi sade kalır. */}})();return()=>{active=false}},[account,panelOpen,tab]);
 useEffect(()=>{if(!account)return;let active=true;void(async()=>{try{const response=await fetch("/api/faction-coalition",{cache:"no-store"});const data=await response.json() as {demand?:CoalitionDemand|null};if(active&&response.ok)setCoalitionDemand(data.demand??null)}catch{/* Koalisyon masası yoksa Halk bölümü sade kalır. */}})();return()=>{active=false}},[account,panelOpen,tab]);
 useEffect(()=>{if(!account)return;let active=true;void(async()=>{try{const response=await fetch("/api/referendum",{cache:"no-store"});const data=await response.json() as {result?:ReferendumResult|null};if(active&&response.ok)setReferendum(data.result??null)}catch{/* Oylama geçmişi yoksa Halk bölümü sade kalır. */}})();return()=>{active=false}},[account,panelOpen,tab]);
 useEffect(()=>{if(!account)return;let active=true;void(async()=>{try{const response=await fetch("/api/fate",{cache:"no-store"});const data=await response.json() as {event?:FateEvent|null};if(active&&response.ok)setFateEvent(data.event??null)}catch{/* Kader anı yoksa Divan sade kalır. */}})();return()=>{active=false}},[account,panelOpen,tab]);
 useEffect(()=>{let local:Game|null=null;localStorage.removeItem(LEGACY_STORE);void(async()=>{try{const authResponse=await fetch("/api/auth",{cache:"no-store"});const authData=await authResponse.json() as {user?:Account|null};if(!authResponse.ok||!authData.user){setAccount(null);setReady(true);return}setAccount(authData.user);setCloudUser(authData.user.displayName);const savedLocal=localStorage.getItem(storeKey(authData.user.id));if(savedLocal)try{local=JSON.parse(savedLocal) as Game}catch{localStorage.removeItem(storeKey(authData.user.id))}const [saveResponse,channelResponse,byokResponse]=await Promise.all([fetch("/api/save",{cache:"no-store"}),fetch("/api/channels",{cache:"no-store"}),fetch("/api/byok",{cache:"no-store"})]);const data=await saveResponse.json() as {game?:Game|null;revision?:number};if(!saveResponse.ok)throw new Error("Bulut kaydı açılamadı");revision.current=data.revision??null;const byokData=await byokResponse.json() as {connected?:boolean;provider?:keyof typeof modelOptions;model?:string};if(byokResponse.ok&&byokData.connected&&byokData.provider&&byokData.model){setStoredByok(true);setProvider(byokData.provider);setModel(byokData.model);setStoredProvider(byokData.provider);setStoredModel(byokData.model)}const channelData=await channelResponse.json() as {activeChannelId?:string|null;channels?:Array<{id:string;name:string;speed:number;durationDays:number;maxPlayers:number;players:number;endsAt?:string|null}>};
        // Üyelik sunucuda yazılıdır; yerel kayıttaki channelId eskiyebilir ve
        // dünya/maden istekleri yanlış channel'a gidip 403 alır.
        if(channelResponse.ok&&channelData.activeChannelId)setServerChannelId(channelData.activeChannelId);
        if(channelResponse.ok&&channelData.channels?.length){const mapped=channelData.channels.map(channel=>{const days=channel.endsAt?Math.max(0,Math.ceil((new Date(channel.endsAt).getTime()-Date.now())/86_400_000)):channel.durationDays;return{id:channel.id,name:channel.name,speed:channel.speed,durationDays:channel.durationDays,maxPlayers:channel.maxPlayers,players:Number(channel.players),detail:`${channel.durationDays} gün · ×${channel.speed} tempo · ${Number(channel.players)}/${channel.maxPlayers} Kral`,remaining:`${days} gün`}});setAvailableChannels(mapped);setSelected(mapped[0])}const source=data.game||local;if(source)setGame({...tick(source,Date.now()),provider:byokData.connected?byokData.provider??source.provider:source.provider,model:byokData.connected?byokData.model??source.model:source.model,generalConnected:Boolean(byokData.connected)});setCloudStatus(data.game?"BULUTTAN YÜKLENDİ":"BULUT HAZIR")}catch{if(local)setGame({...tick(local,Date.now()),generalConnected:false});setCloudStatus("YEREL YEDEK")}finally{setCloudReady(true);setReady(true)}})();},[]);
 // MODELİN TEK KAYNAĞI sunucudaki saklı kimlik bilgisidir: General'in isteği
 // onunla yapılır ve faturayı o belirler. Kayıttaki kopya (game.model) yalnızca
 // gösterim içindir ve başka bir sekmeden/cihazdan model değiştirildiğinde
 // bayatlıyordu; panel bir modeli gösterirken sunucu başkasını kullanıyordu.
 // Burada kayıt sunucunun söylediğine hizalanır.
 useEffect(()=>{if(!storedByok||!storedModel||!storedProvider)return;setGame(g=>g&&(g.model!==storedModel||g.provider!==storedProvider)?{...g,model:storedModel,provider:storedProvider}:g)},[storedByok,storedModel,storedProvider]);
 useEffect(()=>{const id=setInterval(()=>{const n=Date.now();setNow(n);setGame(g=>g?tick(g,n):null)},1000);return()=>clearInterval(id)},[]);
 useEffect(()=>{if(!game){setOtherKingdoms([]);setSharedMine(null);setChannelCompare(null);setVictory(null);setChannelIndex(null);return}const channelId=serverChannelId??game.channelId??availableChannels.find(channel=>channel.name===game.channel)?.id;if(!channelId)return;if(game.channelId!==channelId)setGame(current=>current?{...current,channelId}:current);let active=true;const loadWorld=async()=>{try{const [worldResponse,mineResponse]=await Promise.all([fetch(`/api/world?channelId=${encodeURIComponent(channelId)}`,{cache:"no-store"}),fetch(`/api/mine?channelId=${encodeURIComponent(channelId)}`,{cache:"no-store"})]);const worldData=await worldResponse.json() as {error?:string;kingdoms?:WorldKingdom[];defense?:{active:boolean;activeUntil:number|null};incomingAlerts?:number;home?:{x:number;z:number;ring:number;biome:string};extent?:number;agitation?:AgitationStatus;compare?:ChannelCompare;victory?:VictoryStanding;marketIndex?:ChannelIndex|null};const mineData=await mineResponse.json() as SharedMine;if(active&&!worldResponse.ok){setWorldError(worldData.error??`Dünya haritası alınamadı (HTTP ${worldResponse.status}).`)}if(active&&worldResponse.ok){setWorldError(null);setOtherKingdoms(worldData.kingdoms??[]);setWorldDefense(worldData.defense??{active:false,activeUntil:null});setIncomingAlerts(worldData.incomingAlerts??0);setChannelCompare(worldData.compare??null);setVictory(worldData.victory??null);setChannelIndex(worldData.marketIndex??null);if(worldData.agitation)setAgitation(worldData.agitation);if(worldData.home)setWorldHome(worldData.home);if(worldData.extent)setWorldExtentValue(worldData.extent)}if(active&&mineResponse.ok){setSharedMine(mineData);if(mineData.renewal){setGame(current=>current?{...current,mineWorkers:0}:current);setToast(mineData.renewal.message)}}else if(active&&!mineResponse.ok){setSharedMine(null);setWorldError(current=>current??((mineData as unknown as {error?:string}).error??`Ortak saha alınamadı (HTTP ${mineResponse.status}).`))}}catch(error){if(active){setOtherKingdoms([]);setWorldError(error instanceof Error?error.message:"Dünya haritasına ulaşılamadı.")}}};worldRefresh.current=()=>void loadWorld();void loadWorld();const timer=setInterval(()=>void loadWorld(),10_000);return()=>{active=false;worldRefresh.current=null;clearInterval(timer)}},[game?.channelId,game?.channel,availableChannels]);
  useEffect(()=>{if(game&&ready&&account)localStorage.setItem(storeKey(account.id),JSON.stringify(game));if(!game||!cloudReady||saving.current||Date.now()-lastCloudSave.current<5000)return;saving.current=true;lastCloudSave.current=Date.now();setCloudStatus("KAYDEDİLİYOR");void(async()=>{try{
    const response=await fetch("/api/save",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({game,baseRevision:revision.current})});
    const data=await response.json() as {revision?:number;conflict?:boolean;game?:Game};
    if(response.status===409&&data.game){
      // Sunucu bu arada bir şey yazmış: gece vardiyası, haraç ya da akın.
      // Bizim kopyamız eski; sunucununkini alıp şimdiye kadar ilerletiyoruz.
      revision.current=data.revision??null;
      setGame(tick(data.game,Date.now()));
      setCloudStatus("SUNUCUDAN GÜNCELLENDİ");
      setToast("General siz yokken bir şey yaptı; krallık durumu sunucudan güncellendi.");
      return;
    }
    if(!response.ok)throw new Error();
    revision.current=data.revision??((revision.current??0)+1);
    setCloudStatus("BULUTA KAYDEDİLDİ");
  }catch{setCloudStatus("YEREL YEDEK")}finally{saving.current=false}})()},[game,ready,cloudReady,account]);
 // Sahne başkenti merkeze alır; channel koordinatları olduğu gibi verilirse
 // komşular yanlış yöne düşer. Konumlar eve göre çevrilir ve sahnenin zemini
 // (94 yarıçap) dışında kalanlar hiç çizilmez.
 const SCENE_REACH=74;
 const nearbyKingdoms=useMemo(()=>otherKingdoms.map(kingdom=>({...kingdom,position:{x:kingdom.position.x-worldHome.x,z:kingdom.position.z-worldHome.z}}))
   .filter(kingdom=>Math.hypot(kingdom.position.x,kingdom.position.z)<=SCENE_REACH),[otherKingdoms,worldHome]);
 const nearbyMine=useMemo(()=>{if(!sharedMine)return undefined;
   const position={x:sharedMine.mine.position.x-worldHome.x,z:sharedMine.mine.position.z-worldHome.z};
   return Math.hypot(position.x,position.z)<=SCENE_REACH?{name:sharedMine.mine.name,totalWorkers:sharedMine.mine.totalWorkers,position}:undefined},[sharedMine,worldHome]);

 const diplomaticStatusFor=(kingdom:WorldKingdom)=>{
   const agreement=agreementList.find(deal=>deal.counterpartId===kingdom.id);
   if(agreement)return "Yürürlükte anlaşma";
   const table=negotiationTables.find(item=>item.counterpartId===kingdom.id&&item.status!=="agreed"&&item.status!=="declined");
   if(table)return "Müzakere sürüyor";
   const standing=kingdom.relation??0;
   if(standing>=20)return `Dostane · +${standing}`;
   if(standing>0)return `Olumlu · +${standing}`;
   if(standing<=-20)return `Gergin · ${standing}`;
   if(standing<0)return `Soğuk · ${standing}`;
   return "Resmî temas yok";
 };

 // Müzakere masaları ve yürürlükteki anlaşmalar.
 useEffect(()=>{if(!game?.channelId){setNegotiationTables([]);setAgreementList([]);return}
  let active=true;
  const load=async()=>{try{const response=await fetch("/api/negotiate",{cache:"no-store"});
    if(!response.ok)return;const data=await response.json() as {tables?:NegotiationTable[];agreements?:Agreement[];limits?:{maxTurns:number;maxOpen:number};acceptsNegotiation?:boolean};
    if(!active)return;
    if(typeof data.acceptsNegotiation==="boolean")setEnvoyAccepts(data.acceptsNegotiation);
    const tables=data.tables??[];
    // Karşı taraftan gelen en yeni sözün zamanı; büyüdüyse Kralı uyarırız.
    const latest=Math.max(0,...tables.flatMap(table=>table.messages.filter(message=>!message.mine).map(message=>message.at)));
    const bekleyenMasa=tables.filter(entry=>entry.canAccept
      ||(entry.status!=="agreed"&&entry.status!=="declined"&&entry.messages.length>0&&!entry.messages[entry.messages.length-1].mine));
    if(lastEnvoySeen.current===null){
      // Hesaba ilk girişte de haber ver: rozet tek başına gözden kaçıyordu.
      if(bekleyenMasa.length)setToast(`Elçilikte sizi bekleyen ${bekleyenMasa.length} masa var.`);
    }else if(latest>lastEnvoySeen.current){
      const table=tables.find(entry=>entry.messages.some(message=>!message.mine&&message.at===latest));
      setToast(`Elçilik: ${table?.counterpart??"karşı taraf"} masasına yeni söz geldi.`);
    }
    lastEnvoySeen.current=latest;
    if(data.limits)setEnvoyLimits(data.limits);
    setNegotiationTables(tables);setAgreementList(data.agreements??[])}catch{/* sessiz: masa yoksa panel de yok */}};
  negotiationRefresh.current=()=>void load();void load();
  const timer=setInterval(()=>void load(),20_000);
  return()=>{active=false;negotiationRefresh.current=null;clearInterval(timer)}},[game?.channelId]);

 const generalName=game?generalNameFor(game.kingdomName,game.foundedAt):"General";
 const lv=game?keep(game):1,rt=useMemo(()=>game?rates(game):null,[game]);
 const worldEvent=useMemo(()=>game?worldEventStatusAt(game,now):null,[game,now]);
 // Halkin durumu: uretim carpani ve is birakma esigi buradan okunur.
 const mood=useMemo(()=>game?moodState(game.popularity,suppression(armySize(game.units),game.population,game.soldierUnrest??0,factionPressureOf(game))):{id:"uneasy" as const,label:"—",production:1,populationRate:0,populationPerHour:0},[game]);
 // Kuruluş durumu TEK KAYNAKTAN gelir (engine/founding.ts). Burada elle yazılıydı
 // ve kaynak/kapasite/koruma değerleri sunucudaki kopyasından sessizce sapıyordu.
 function found(connected:boolean,introduction?:string){const t=Date.now();const g:Game=foundKingdom({kingdomName:name.trim(),rulerName:ruler.trim(),channel:selected.name,channelId:selected.id,speed:selected.speed,terrain,provider:connected?provider:null,model:connected?model:null,generalConnected:connected},t);// Katılım beklenmeden gönderiliyordu: başarısız olduğunda krallık kuruluyor
    // ama üyelik yazılmıyor, sonra dünya ve maden istekleri 403 alıp harita boş
    // kalıyordu. Artık sonucu bekliyoruz ve başarısızlık açıkça söyleniyor.
    void(async()=>{try{const response=await fetch("/api/channels",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({channelId:selected.id,kingdomName:name.trim()})});
      if(!response.ok){const data=await response.json() as {error?:string;nameTaken?:boolean};
        if(data.nameTaken){setToast(data.error||"Bu ad dolu; başka bir krallık adı seçin.");setGame(null);return}
        setWorldError(data.error||"Channel katılımı kaydedilemedi; komşular ve ortak saha görünmeyecek.");setToast(data.error||"Channel katılımı kaydedilemedi.")}
      else setServerChannelId(selected.id)}catch{setWorldError("Channel katılımı kaydedilemedi; komşular ve ortak saha görünmeyecek.")}})();setGame(g);setChat([{who:connected?generalName:"Saray Kâtibi",text:connected?(introduction||"Bağlantı doğrulandı. İlk hedefinizi ve yönetim doktrinimizi belirleyin."):"General henüz sessiz. Üretim ve kuyruklar çalışır; yeni yönetim kararları için BYOK General'i bağlamalısınız.",kind:connected?"general":"clerk"}]);if(!localStorage.getItem("demirkale.tutorial.done"))setTutorialStep(0)}
 function kingdomContext(g:Game|null){if(!g){
  // Krallık henüz kurulmadan General'e gönderilen yedek bağlam. Kaynaklar ve
  // saatlik oranlar burada ELLE yazılıydı (hourlyRates:{gold:3.3,food:14.5,…});
  // motorun formülü değişince sessizce sapıyordu. Artık kanonik kuruluş
  // durumundan türetilir ve oranlar motorun `rates()` fonksiyonundan okunur.
  const seed=foundKingdom({kingdomName:name.trim(),rulerName:ruler.trim(),channel:selected.name,channelId:selected.id,speed:selected.speed,terrain},Date.now());
  return{name:seed.kingdomName,ruler:seed.rulerName,terrain:terrainCatalog[seed.terrain]??terrainCatalog.plain,keepLevel:keep(seed),population:seed.population,popularity:seed.popularity,loyalty:seed.loyalty,quota:seed.quota,strategyNote:"Henüz belirlenmedi",resources:seed.resources,hourlyRates:rates(seed),buildings:seed.buildings.map(b=>({name:b.name,level:b.level})),units:seed.units,channelSpeed:seed.speed,channelId:seed.channelId,activeConstruction:null,activeTraining:null}}
  const level=keep(g),buildTimes=buildOptions(g);
  const gMood=moodState(g.popularity,suppression(armySize(g.units),g.population,g.soldierUnrest??0,factionPressureOf(g)));
  const nufus={mevcut:Math.round(g.population),kapasite:g.capacity,bosKonut:Math.floor(g.capacity-g.population),gunlukDegisim:Math.round(populationChange(gMood,g.population,g.capacity,g.buildings,24)),kurulustanBeriYerlesen:Math.round(g.peopleJoined??0),kurulustanBeriGocEden:Math.round(g.peopleLeft??0),madende:Math.round(g.mineWorkers??0),silahAltinda:armyManpower(g.units),halkinDurumu:gMood.label};
  const pazar=marketState(g,Date.now(),channelIndex??undefined);
  const activeConstruction=g.constructionQueue?.find(job=>job.startedAt!==null)??g.queue;
  return{name:g.kingdomName,ruler:g.rulerName,generalName:generalNameFor(g.kingdomName,g.foundedAt),pazar:{seviye:pazar.level,gunlukHacim:pazar.limit,kalanHacim:pazar.left,satisFiyatlari:pazar.price,alisCarpani:pazar.spread},terrain:terrainCatalog[g.terrain]??terrainCatalog.plain,keepLevel:level,population:g.population,nufus,popularity:g.popularity,loyalty:g.loyalty,quota:g.quota,strategyNote:g.strategyNote??"Ekonomiyi dengede tut ve halkı aç bırakma.",taxRate:g.taxRate,resources:g.resources,hourlyRates:rates(g),worldEvent:worldEventSummary(g,Date.now()),buildings:g.buildings.map(b=>({type:b.type,name:b.name,level:b.level})),units:g.units,channelSpeed:g.speed,channelId:g.channelId??availableChannels.find(channel=>channel.name===g.channel)?.id,activeConstruction:activeConstruction?{name:activeConstruction.name,secondsRemaining:Math.max(0,Math.ceil(((activeConstruction.completesAt??Date.now())-Date.now())/1000))}:null,activeTraining:g.trainingQueue?{name:g.trainingQueue.name,secondsRemaining:Math.max(0,Math.ceil((g.trainingQueue.completesAt-Date.now())/1000))}:null,buildTimes,
   // Maden, komşular ve nöbet durumu olmadan General bu alanlarda körlemesine karar verir.
   mine:sharedMine?{workers:sharedMine.participants.find(p=>p.self)?.workers??0,totalWorkers:sharedMine.mine.totalWorkers,oreRemaining:sharedMine.mine.oreRemaining}:null,
   neighbors:otherKingdoms.map((kingdom,index)=>({ordinal:index+1,name:kingdom.discovered&&kingdom.name?kingdom.name:"Bilinmeyen Sancak",discovered:kingdom.discovered,scouting:kingdom.mission?.status==="pending"})),
   counterIntelligence:{active:worldDefense.active,minutesRemaining:worldDefense.activeUntil?Math.max(0,Math.ceil((worldDefense.activeUntil-Date.now())/60_000)):0},
   protectionHoursLeft:Math.max(0,(g.protectionEndsAt-Date.now())/3_600_000),
   populace:(()=>{const r=rationsOf(g),army=armySize(g.units),state=moodState(g.popularity,suppression(army,g.population,g.soldierUnrest??0,factionPressureOf(g)));
    // Halkın sesi (engine/populace-voice.ts) fiilen dağıtılan istihkakı ve geçim
    // endeksini okur; ikisi de motordan gelir, burada yeniden hesaplanmaz.
    const served=servedRations(g),garrison=garrisonMood(g.soldierUnrest??0,army);
    return{mood:state.label,moodScore:Math.round(g.popularity),productionMultiplier:state.production,foodRation:r.food,aleRation:r.ale,soldierPay:r.soldierPay,army,soldierUnrest:Math.round(g.soldierUnrest??0),dailyFoodNeed:Math.round(g.population*NEED.food*24),
     servedFood:Math.round(served.food),servedPay:Math.round(served.pay),livingCost:pazar.livingCost,capacity:g.capacity,
     garrison:{label:garrison.label,note:garrison.note,vetoes:garrisonVetoes(g.soldierUnrest??0,army)},
     // Muhalefet: General bunu görmeden "askerle bastır" gibi olmayan bir yol öneriyordu.
     muhalefet:(()=>{const pressure=factionPressureOf(g),state=factionState(pressure);
      return{baski:Math.round(pressure),durum:state.label,
       elebasi:pressure>=FACTION_THRESHOLDS.organized?factionLeaderName(g.kingdomName,g.foundedAt):null}})()}})(),
   defense:(()=>{const d=defenseOf(g);
    return{watchRatio:d.watch,watchers:d.watchers,wallLevel:d.wall,power:Math.round(d.power*10)/10,terrainDefense:terrainCatalog[g.terrain]?.defense??1,
     raidsRepelled:g.raidsRepelled??0,raidsSuffered:g.raidsSuffered??0,
     hoursSinceLastRaid:g.lastRaidAt?Math.round((Date.now()-g.lastRaidAt)/3_600_000):null,
     recentRaids:g.notices.filter(n=>n.kind==="AKIN").slice(0,3).map(n=>({text:n.text,hoursAgo:Math.round((Date.now()-n.at)/3_600_000)}))}})()}}
 async function refreshCouncil(){
  if(!game||councilBusy||Date.now()-lastCouncilLoaded.current<10_000)return;
  setCouncilBusy(true);setCouncilError("");
  try{
   const response=await fetch("/api/council",{cache:"no-store"});
   const data=await response.json() as CouncilResponse;
   if(!response.ok)throw new Error(data.error||"Divan görüşleri alınamadı.");
   setCouncilMeetings(data.meetings??[]);if(data.briefing){setCouncilBriefing(data.briefing);setAiConnections(data.briefing.connections);setCouncilVoices(data.briefing.voices);}
   lastCouncilLoaded.current=Date.now();
  }catch(error){setCouncilError(error instanceof Error?error.message:"Divan görüşleri alınamadı.")}
  finally{setCouncilBusy(false)}
 }
 async function acknowledgeCouncil(){
  if(councilBriefing?.readAt||councilBusy)return;
  setCouncilBusy(true);setCouncilError("");
  try{const response=await fetch("/api/council",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"acknowledge"})});const data=await response.json() as CouncilResponse;if(!response.ok)throw new Error(data.error||"Divan belgesi işaretlenemedi.");setCouncilMeetings(data.meetings??[]);if(data.briefing){setCouncilBriefing(data.briefing);setCouncilVoices(data.briefing.voices);setAiConnections(data.briefing.connections)}}catch(error){setCouncilError(error instanceof Error?error.message:"Divan belgesi işaretlenemedi.")}finally{setCouncilBusy(false)}
 }
 async function callCouncil(){
  if(councilBusy)return;
  setCouncilBusy(true);setCouncilError("");
  try{const response=await fetch("/api/council",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"call"})});const data=await response.json() as CouncilResponse;if(!response.ok)throw new Error(data.error||"Divan çağrısı kayda alınamadı.");setCouncilMeetings(data.meetings??[]);if(data.briefing){setCouncilBriefing(data.briefing);setCouncilVoices(data.briefing.voices);setAiConnections(data.briefing.connections)}if(data.scheduledAt)setToast(data.alreadyScheduled?`Divan çağrısı zaten kayıtta · ${councilTime(data.scheduledAt)}.`:`Divan çağrısı kayda alındı · toplantı ${councilTime(data.scheduledAt)}.`)}catch(error){setCouncilError(error instanceof Error?error.message:"Divan çağrısı kayda alınamadı.")}finally{setCouncilBusy(false)}
 }
 // Meclis açıkken belge hafifçe yenilenir; model çağrısı yine yalnız cron ritmindedir.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 useEffect(()=>{if(panelOpen&&tab==="meclis"&&game)void refreshCouncil()},[panelOpen,tab,game?.foundedAt,now]);
 function closeTutorial(){localStorage.setItem("demirkale.tutorial.done","1");setTutorialStep(null)}
 function advanceTutorial(){if(tutorialStep===null)return;const next=tutorialStep+1;if(next>=5)return closeTutorial();setTutorialStep(next);setPanelOpen(true);if(next===1)setTab("meclis");if(next===2)setTab("binalar");if(next===3)setTab("defter");if(next===4)setTab("diyar")}
 async function worldAction(action:"scout"|"deep_observation"|"spy_network"|"defend",targetId?:string){if(!game?.channelId||worldBusy)return;setWorldBusy(true);try{const response=await fetch("/api/world",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,channelId:game.channelId,targetId})});const data=await response.json() as {error?:string;completesAt?:number;successChance?:number;activeUntil?:number;deploysAt?:number;cost?:number;kind?:"scout"|"deep_observation"|"spy_network"};if(!response.ok)throw new Error(data.error||"Dünya emri uygulanamadı.");if(action==="defend")setWorldDefense({active:true,activeUntil:data.activeUntil??null});else if(action==="spy_network")setOtherKingdoms(items=>items.map(item=>item.id===targetId?{...item,network:{status:"deploying",deploysAt:data.deploysAt??Date.now(),nextReportAt:null,exposedAt:null}}:item));else setOtherKingdoms(items=>items.map(item=>item.id===targetId?{...item,mission:{status:"pending",completesAt:data.completesAt??Date.now(),successChance:data.successChance??10,kind:data.kind==="deep_observation"?"deep_observation":"scout"}}:item));setToast(action==="defend"?"Karşı-istihbarat nöbeti bir saatliğine kuruldu.":action==="spy_network"?`Casus ağı yola çıktı · ${data.cost??300} altın ayrıldı; yerleşince Defter'e rapor düşecek.`:action==="deep_observation"?`Derin gözetleme yolda · ${data.cost??100} altın ayrıldı, başarı ihtimali %${data.successChance??5}.`:`Ajan yola çıktı · başarı ihtimali %${data.successChance??10}.`)}catch(error){setToast(error instanceof Error?error.message:"Dünya emri uygulanamadı.")}finally{setWorldBusy(false)}}
 async function agitationAction(targetId:string,kind:"gold_commons"|"support_movement"|"gold_garrison"|"goods_glut"|"raid_lure"|"spy_network",resource="food"){
  if(kind==="spy_network"){void worldAction("spy_network",targetId);return}
  if(!game?.channelId||worldBusy)return;setWorldBusy(true);
  try{const response=await fetch("/api/world",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"agitate",channelId:game.channelId,targetId,kind,resource})});const data=await response.json() as {error?:string;completesAt?:number;cost?:number};if(!response.ok)throw new Error(data.error||"Dolaylı operasyon gönderilemedi.");setAgitation(current=>({...current,sentToday:Math.min(current.perDay,current.sentToday+1)}));setToast(`Operasyon yola çıktı · ${data.cost??agitation.cost} altın · varış ${left(data.completesAt??now,now)}.`);worldRefresh.current?.()}catch(error){setToast(error instanceof Error?error.message:"Dolaylı operasyon gönderilemedi.")}finally{setWorldBusy(false)}
 }
async function openNegotiation(){
  if(worldBusy||!envoyTarget)return;setWorldBusy(true);
  try{
   const response=await fetch("/api/negotiate",{method:"POST",headers:{"content-type":"application/json"},
     body:JSON.stringify({action:"open",targetId:envoyTarget,topic:envoyTopic,message:envoyMessage.trim()})});
   const data=await response.json() as {error?:string};
   if(!response.ok)throw new Error(data.error||"Masa açılamadı.");
   setEnvoyMessage("");setEnvoyTarget("");
   setToast("Elçi yola çıktı; karşı tarafın cevabı bekleniyor.");
   negotiationRefresh.current?.();
  }catch(error){setToast(error instanceof Error?error.message:"Masa açılamadı.")}
  finally{setWorldBusy(false)}
 }

 // Elçilik kapısı. Kapalıyken kimse yeni masa açamaz; Kral çevrimdışıyken
 // Generalinin YABANCI masalarda kendi BYOK anahtarıyla cevap yazması buradan
 // durur. Anahtar hiç panelde yoktu: hiçbir Kral müzakereye kapanamıyordu.
 async function setEnvoyDoor(accepts:boolean){
  if(worldBusy)return;setWorldBusy(true);
  try{
   const response=await fetch("/api/negotiate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"set_open",accepts})});
   const data=await response.json() as {error?:string;acceptsNegotiation?:boolean};
   if(!response.ok)throw new Error(data.error||"Elçilik kapısı değiştirilemedi.");
   setEnvoyAccepts(data.acceptsNegotiation??accepts);
   setToast(accepts?"Elçilik kapısı açıldı; size yeniden masa açılabilir.":"Elçilik kapısı kapandı; size yeni masa açılamaz, açık masalar sürer.");
   negotiationRefresh.current?.();
  }catch(error){setToast(error instanceof Error?error.message:"Elçilik kapısı değiştirilemedi.")}
  finally{setWorldBusy(false)}
 }

 // Kral kendi eliyle şart sunar. Haraç ya SABİT miktar ya ORAN olur; ikisi
 // birden gönderilmez, çünkü motor ikisi birden gelince sabit rakamı esas alır
 // ve Kral yazdığı oranın yok sayıldığını göremezdi.
 async function proposeTerms(table:NegotiationTable){
  if(worldBusy||!envoyTerm||envoyTerm.tableId!==table.id)return;
   const tribute=carriesTribute(table.topic as NegotiationTopic),mercenary=table.topic==="mercenary",value=Number(envoyTerm.value)||0;
  const karsiTaraf=table.side==="initiator"?"target":"initiator";
  setWorldBusy(true);
  try{
   const terms={topic:table.topic,hours:Number(envoyTerm.hours)||24,everyHours:Number(envoyTerm.everyHours)||6,
    ...(tribute?{payerSide:envoyTerm.payer==="us"?table.side:karsiTaraf,resource:envoyTerm.resource,
      tributeAmount:envoyTerm.mode==="amount"?Math.floor(value):0,
      tributeRate:envoyTerm.mode==="rate"?tributeRateFromPercent(value):0}:mercenary?{
        lessorSide:envoyTerm.lessor==="us"?table.side:karsiTaraf,
        mercenaryCount:Math.floor(Number(envoyTerm.mercenaryCount)||0),
        mercenaryFee:Math.floor(Number(envoyTerm.mercenaryFee)||0)}:{})};
   const response=await fetch("/api/negotiate",{method:"POST",headers:{"content-type":"application/json"},
     body:JSON.stringify({action:"propose",speaker:"king",negotiationId:table.id,message:envoyTerm.note.trim()||"Şartımız ektedir.",terms})});
   const data=await response.json() as {error?:string};
   if(!response.ok)throw new Error(data.error||"Şart sunulamadı.");
   setEnvoyTerm(null);
   setToast(`Şart ${table.counterpart} tarafına sunuldu; imzaları bekleniyor.`);
   negotiationRefresh.current?.();
  }catch(error){setToast(error instanceof Error?error.message:"Şart sunulamadı.")}
  finally{setWorldBusy(false)}
 }

 async function negotiationAction(negotiationId:string,action:"accept"|"decline"){
  if(worldBusy)return;setWorldBusy(true);
  try{
   const response=await fetch("/api/negotiate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,negotiationId})});
   const data=await response.json() as {error?:string};
   if(!response.ok)throw new Error(data.error||"Müzakere emri uygulanamadı.");
   setToast(action==="accept"?"Anlaşma imzalandı; şartlar yürürlüğe girdi.":"Şart reddedildi.");
   negotiationRefresh.current?.();
  }catch(error){setToast(error instanceof Error?error.message:"Müzakere emri uygulanamadı.")}
  finally{setWorldBusy(false)}
 }

 async function replyAsKing(table:NegotiationTable){
  const text=kingReply?.tableId===table.id?kingReply.text.trim():"";
  if(worldBusy||!text)return;
  setWorldBusy(true);
  try{
   const response=await fetch("/api/negotiate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"reply",speaker:"king",negotiationId:table.id,message:text})});
   const data=await response.json() as {error?:string};
   if(!response.ok)throw new Error(data.error||"Kralın sözü masaya ulaştırılamadı.");
   setKingReply(null);
   setToast(`${table.counterpart} masasına kendi sözünüz gönderildi.`);
   negotiationRefresh.current?.();
  }catch(error){setToast(error instanceof Error?error.message:"Kralın sözü masaya ulaştırılamadı.")}
  finally{setWorldBusy(false)}
 }

 async function mineAction(action:"join"|"leave"){if(!game?.channelId||worldBusy)return;const minersToSend=Math.max(1,Math.min(5,sharedMine?.personalCap??3));setWorldBusy(true);try{const response=await fetch("/api/mine",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,channelId:game.channelId,workers:minersToSend})});const data=await response.json() as {error?:string;workers?:number};if(!response.ok)throw new Error(data.error||"Maden emri uygulanamadı.");setGame(current=>current?{...current,mineWorkers:data.workers??0}:current);setToast(action==="join"?`Ortak madene ${data.workers??minersToSend} işçi gönderildi; saatte ~${Math.round((data.workers??minersToSend)*(sharedMine?.orePerWorkerHour??0))} cevher bekleniyor, o eller tarladan eksildi.`:"İşçiler ortak madenden çekildi, kalan cevher ambara indirildi.");const mineResponse=await fetch(`/api/mine?channelId=${encodeURIComponent(game.channelId)}`,{cache:"no-store"});if(mineResponse.ok)setSharedMine(await mineResponse.json() as SharedMine)}catch(error){setToast(error instanceof Error?error.message:"Maden emri uygulanamadı.")}finally{setWorldBusy(false)}}
 // Sunucu FİİLEN hangi modeli kullandıysa onu geri bildirir; panel kendi
 // seçimini değil o cevabı esas alır. Model üç yerde (saklı kimlik bilgisi,
 // kayıt, panel) duruyordu ve saklı anahtar varken sunucu eskisini kullanıp
 // panel yenisini gösteriyordu — fatura yanlış modele yazılıyordu.
 // GEÇMİŞİN ROLLERİ TAHMİN EDİLMEZ: burada eskiden "Kral değilse General'dir"
 // denip her satır General'e mal ediliyordu. Halkın balonu sohbete girdiğinden
 // beri bu, General'in halkın şikâyetini kendi sözü sanması demek olurdu;
 // süzgeç `generalHistory` içinde ve testli.
 async function askGeneral(mode:"test"|"chat",text?:string){const history=generalHistory(chat);const response=await fetch("/api/general",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({provider,model,...(apiKey?{apiKey}:{}),mode,message:text,history,kingdom:kingdomContext(game)})});const data=await response.json() as {text?:string;actions?:GeneralAction[];error?:string;requests?:GeneralRequest[];populaceDemands?:PopulaceDemand[];pendingDecision?:{peoplePulse?:{label:string;note:string};riskLevel?:"elevated"|"severe"}|null;provider?:keyof typeof modelOptions;model?:string};if(!response.ok)throw new Error(data.error||"General bağlantısı başarısız oldu.");setGeneralRequests(data.requests??[]);setPopulaceDemands(data.populaceDemands??[]);const used={provider:data.provider??provider,model:data.model??model};if(used.provider!==provider)setProvider(used.provider);if(used.model!==model)setModel(used.model);const pulse=data.pendingDecision?.peoplePulse&&data.pendingDecision.riskLevel?{...data.pendingDecision.peoplePulse,riskLevel:data.pendingDecision.riskLevel}:null;return{text:data.text||"General bağlantısı doğrulandı.",actions:data.actions??[],populaceDemands:data.populaceDemands??[],pulse,used}}
 async function persistByok(){const response=await fetch("/api/byok",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({provider,model,apiKey})});const data=await response.json() as {error?:string};if(!response.ok)throw new Error(data.error||"BYOK bağlantısı kaydedilemedi.");setStoredByok(true);setStoredModel(model);setStoredProvider(provider);setReplaceByok(false);setApiKey("")}
 // Anahtar yeniden girilmeden model değiştirme. Anahtar AES-GCM ile şifrelenirken
 // model `additionalData` içinde yazdığı için sunucu anahtarı yeni modelin
 // altında YENİDEN ŞİFRELER; sütunu tek başına güncellemek çözmeyi bozar ve
 // General susardı.
 async function patchByokModel(){const response=await fetch("/api/byok",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({provider,model})});const data=await response.json() as {error?:string;model?:string};if(!response.ok)throw new Error(data.error||"Model değiştirilemedi.");setStoredModel(data.model??model)}
 async function connectAndFound(){if(!apiKey.trim())return setGeneralError("API anahtarını girmelisiniz.");setConnecting(true);setGeneralError("");try{const intro=await askGeneral("test");await persistByok();found(true,intro.text)}catch(error){setGeneralError(error instanceof Error?error.message:"Bağlantı kurulamadı.")}finally{setConnecting(false)}}
 async function reconnectGeneral(){if(!game||(!apiKey.trim()&&!storedByok))return setGeneralError("API anahtarını girmelisiniz.");
  // Sağlayıcı değişimi yeni anahtar ister: OpenAI anahtarı Anthropic'te çalışmaz.
  if(!apiKey.trim()&&storedByok&&storedProvider&&provider!==storedProvider)return setGeneralError("Sağlayıcıyı değiştirmek için API anahtarını yeniden girmelisiniz.");
  setConnecting(true);setGeneralError("");
  try{
   // Model değişikliği ÖNCE sunucuya yazılır; yoksa test çağrısı eski modele
   // gider ve panel yeni modeli göstererek ayrışırdı.
   if(!apiKey.trim()&&storedByok&&model!==storedModel)await patchByokModel();
   const intro=await askGeneral("test");
   if(apiKey.trim())await persistByok();
   setGame({...game,provider:intro.used.provider,model:intro.used.model,generalConnected:true});
   setChat(x=>[...x,{who:generalName,text:intro.text,kind:"general"}]);setShowConnect(false);setToast("General bağlantısı hesaba şifreli olarak kaydedildi.")
  }catch(error){setGeneralError(error instanceof Error?error.message:"Bağlantı kurulamadı.")}finally{setConnecting(false)}}
 // Sunucu tarafı eylemler: sonuç metni her zaman API'nin gerçek cevabından üretilir.
 async function executeRemoteActions(actions:GeneralAction[],channelId:string|undefined){
  const results:string[]=[];
  if(!actions.length)return results;
  if(!channelId){actions.forEach(()=>results.push("✕ Bu emir için channel bilgisi çözülemedi."));return results}
  for(const action of actions){
   try{
    if(action.name==="set_defense_doctrine"||action.name==="respond_to_war"){
     const doctrine=String(action.arguments.doctrine);
     if(!["cautious","balanced","hard_response"].includes(doctrine)){results.push("✕ Savunma doktrini geçersiz.");continue}
     const response=await fetch("/api/war",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"set_doctrine",doctrine})});
     const data=await response.json() as {error?:string};
     results.push(response.ok?`✓ Savunma doktrini kaydedildi: ${doctrine==="cautious"?"temkinli":doctrine==="hard_response"?"sert karşılık":"dengeli"}.`:`✕ Savunma doktrini kaydedilemedi: ${data.error??"sunucu reddetti."}`);
     continue;
    }
    if(action.name==="propose_campaign"){
     const ordinal=Math.floor(Number(action.arguments.target_ordinal)),target=otherKingdoms[ordinal-1];
     if(!target||!target.discovered){results.push("✕ Sefer taslağı bırakılamadı: hedef önce Diyar haritasında keşfedilmiş olmalı.");continue}
     const objective=String(action.arguments.objective),approach=String(action.arguments.approach);
     if(!["raid","concession","siege","blockade"].includes(objective)||!["cautious","balanced","intense"].includes(approach)){results.push("✕ Sefer taslağı geçersiz bir amaç veya yaklaşım içeriyor.");continue}
     const withdrawThreshold=Math.max(20,Math.min(80,Math.round(Number(action.arguments.withdraw_threshold)||50)));
     setCampaignTarget(target.id);
     setCampaignDraft({targetId:target.id,objective:objective as CampaignDraft["objective"],approach:approach as CampaignDraft["approach"],withdrawThreshold,recommendedUnits:String(action.arguments.recommended_units??"General birlik bileşimini Sefer Masası'nda gözden geçirmenizi istiyor."),rationale:String(action.arguments.rationale??"General sefer koşullarını değerlendirdi.")});
     results.push(`✓ ${target.name??`${ordinal}. sancak`} için General taslağı Sefer Masası'na bırakıldı. Savaş başlamadı; birlikleri ve ikmali siz mühürlemeden değiştirebilirsiniz.`);
     continue;
    }
    if(action.name==="open_negotiation"){
     // Hedef ordinal ile gelir; kimlik uydurulmasın diye listeden çözülür.
     const ordinal=Math.floor(Number(action.arguments.target_ordinal)),target=otherKingdoms[ordinal-1];
     if(!target){results.push("✕ Müzakere açılmadı: o sırada bir sancak yok.");continue}
     const response=await fetch("/api/negotiate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"open",targetId:target.id,topic:String(action.arguments.topic??"non_aggression"),message:String(action.arguments.message??"")})});
     const data=await response.json() as {error?:string};
     results.push(response.ok?`✓ ${target.name??"Bilinmeyen Sancak"} ile müzakere masası açıldı.`:`✕ Müzakere açılmadı: ${data.error??"sunucu reddetti."}`);
     if(response.ok)negotiationRefresh.current?.();
     continue;
    }
    if(action.name==="reply_negotiation"||action.name==="propose_terms"){
     const ordinal=Math.floor(Number(action.arguments.table_ordinal)),table=negotiationTables[ordinal-1];
     if(!table){results.push("✕ O sırada açık bir müzakere masası yok.");continue}
     const propose=action.name==="propose_terms";
     const payload=propose
      ?{action:"propose",speaker:"general",negotiationId:table.id,message:String(action.arguments.message??"Şartımız ektedir."),
        terms:{topic:table.topic,
          // "us" bizim ödediğimiz demek; taraf adına burada çevrilir.
          payerSide:String(action.arguments.payer??"them")==="us"?table.side:(table.side==="initiator"?"target":"initiator"),
          resource:String(action.arguments.resource??"gold"),
          tributeAmount:Math.floor(Number(action.arguments.amount_per_payment)||0),
          // Oranlı haraç sunucuda hazırdı ama panel `rate_percent` alanını
          // düşürüyordu: General oran önerse bile masaya hiç ulaşmıyordu.
          tributeRate:tributeRateFromPercent(action.arguments.rate_percent),
          lessorSide:String(action.arguments.lessor??"them")==="us"?table.side:(table.side==="initiator"?"target":"initiator"),
          mercenaryCount:Math.floor(Number(action.arguments.mercenary_count)||0),
          mercenaryFee:Math.floor(Number(action.arguments.mercenary_fee)||0),
          everyHours:Math.floor(Number(action.arguments.every_hours)||6),
          hours:Math.floor(Number(action.arguments.hours)||24)}}
      :{action:"reply",speaker:"general",negotiationId:table.id,message:String(action.arguments.message??"")};
     const response=await fetch("/api/negotiate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
     const data=await response.json() as {error?:string};
     results.push(response.ok
      ?(propose?`✓ Şart ${table.counterpart} tarafına sunuldu; onayları bekleniyor.`:`✓ ${table.counterpart} masasına cevap yazıldı.`)
      :`✕ Müzakere emri uygulanmadı: ${data.error??"sunucu reddetti."}`);
     if(response.ok)negotiationRefresh.current?.();
     continue;
    }
    if(action.name==="hold_referendum"){
     const response=await fetch("/api/referendum",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({topic:action.arguments.topic})});
     const data=await response.json() as {result?:ReferendumResult;error?:string};
     if(!response.ok){results.push(`✕ Halk oylaması yapılamadı: ${data.error??"sunucu reddetti."}`);continue}
     setReferendum(data.result??null);
     results.push(`✓ Halk oylaması tamamlandı: ${data.result?.question??"soru"} — destek %${data.result?.support??0}. Karar hâlâ sizin.`);
     continue;
    }
    if(action.name==="send_miners"||action.name==="recall_miners"){
     const join=action.name==="send_miners",workers=Math.max(1,Math.min(20,Math.floor(Number(action.arguments.workers)||5)));
     const response=await fetch("/api/mine",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(join?{channelId,action:"join",workers}:{channelId,action:"leave"})});
     const data=await response.json() as {working?:boolean;workers?:number;error?:string};
     if(!response.ok){results.push(`✕ Maden emri uygulanmadı: ${data.error??"sunucu reddetti."}`);continue}
     // Madenciler halkın içinden çıkar: yerel üretimden düşerler.
     setGame(current=>current?{...current,mineWorkers:data.workers??0}:current);
     results.push(join?`✓ Ortak madene ${data.workers??workers} işçi görevlendirildi; tarladan o kadar el eksildi.`:"✓ Madendeki işçiler geri çekildi, tarlaya döndüler.");
     continue;
    }
    if(action.name==="send_purse"){
     const ordinal=Math.floor(Number(action.arguments.target_ordinal));const target=otherKingdoms[ordinal-1];
     if(!target){results.push(`✕ Kese emri uygulanmadı: ${ordinal}. sancak haritada yok.`);continue}
     const aim=String(action.arguments.target);
     const kind=aim==="garrison"?"gold_garrison":aim==="market"?"goods_glut":aim==="raids"?"raid_lure":"gold_commons";
     const where=kind==="gold_garrison"?"kışlasına":kind==="goods_glut"?"pazarına":kind==="raid_lure"?"yollarına":"halkının arasına";
     const response=await fetch("/api/world",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"agitate",channelId,targetId:target.id,kind,resource:action.arguments.resource})});
     const data=await response.json() as {sent?:boolean;cost?:number;resource?:string;error?:string};
     if(!response.ok){results.push(`✕ Kese gönderilemedi: ${data.error??"sunucu reddetti."}`);continue}
     results.push(`✓ ${target.name??`${ordinal}. sancağın`} ${where} ${data.cost??600} ${data.resource??"gold"} değerinde kese yollandı. Sonucunu ancak hedefin kendisi hissedecek.`);
     worldRefresh.current?.();
     continue;
    }
    if(action.name==="send_scout"){
     const ordinal=Math.floor(Number(action.arguments.target_ordinal));const target=otherKingdoms[ordinal-1];
     if(!target){results.push(`✕ Ajan emri uygulanmadı: ${ordinal}. sancak haritada yok.`);continue}
     const response=await fetch("/api/world",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"scout",channelId,targetId:target.id})});
     const data=await response.json() as {sent?:boolean;successChance?:number;error?:string};
     if(!response.ok){results.push(`✕ Ajan gönderilemedi: ${data.error??"sunucu reddetti."}`);continue}
     results.push(`✓ ${target.name??`${ordinal}. sancağa`} ajan yollandı; başarı ihtimali %${data.successChance??10}.`);
     continue;
    }
    const response=await fetch("/api/world",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"defend",channelId})});
    const data=await response.json() as {defended?:boolean;error?:string};
    results.push(response.ok?"✓ Karşı-istihbarat nöbeti bir saatliğine kuruldu.":`✕ Nöbet kurulamadı: ${data.error??"sunucu reddetti."}`);
   }catch{results.push("✕ Emir sunucuya iletilemedi.")}
  }
  return results;
 }
 async function submitOrder(order:string){if(!game||!order.trim()||connecting)return;setChat(x=>[...x,{who:game.rulerName,text:order.trim(),kind:"king"}]);setMessage("");setTab("general");setPanelOpen(true);if(!game.generalConnected){setChat(x=>[...x,{who:"Saray Kâtibi",text:"General bağlantısı etkin değil. Hesabındaki BYOK bağlantısını yenilemelisin.",kind:"clerk"}]);setShowConnect(true);return}setConnecting(true);try{const answer=await askGeneral("chat",order.trim()),execution=applyActions(game,answer.actions,Date.now(),channelIndex??undefined);setPeoplePulse(answer.pulse);if(answer.actions.length)setGame(execution.game);const remoteResults=await executeRemoteActions(execution.remote,game.channelId??availableChannels.find(channel=>channel.name===game.channel)?.id);const merged=[...execution.results,...remoteResults];const outcome=merged.length?`\n\n${merged.join("\n")}`:"";
  // HALK ARAYA GİRER (plan belgesi Fikir 16). Balon General'in cevabının
  // ÖNÜNE konur: halkın gücü sözü kesmesindedir, cevabı beklemesinde değil.
  // Eşik ve tekrar freni `pickInterjections`'ta; buradaki iş yalnızca
  // konuşanları deftere yazıp balonları sohbete eklemek.
  const interjections=pickInterjections(answer.populaceDemands,spokenInterjections.current);
  for(const demand of interjections)spokenInterjections.current.add(interjectionKey(demand));
  setChat(x=>[...x,...interjections.map(demand=>({who:interjectionSpeaker(demand.voice),text:demand.text,kind:"populace" as const,voice:demand.voice})),{who:generalName,text:`${answer.text}${outcome}`,kind:"general" as const}]);
  setCouncilVoices(current=>[...current.filter(voice=>voice.role!=="general"),{role:"general",speaker:generalName,text:answer.text,priority:"steady",mode:"ai"}]);
  setAiConnections(current=>current.map(connection=>connection.role==="general"?{...connection,state:"connected",provider:answer.used.provider,model:answer.used.model,source:"player"}:connection));
  lastCouncilLoaded.current=0;
  if(remoteResults.some(line=>line.startsWith("✓")))worldRefresh.current?.()}catch(error){setChat(x=>[...x,{who:"Saray Kâtibi",text:error instanceof Error?error.message:"General yanıt veremedi.",kind:"clerk"}]);setGame({...game,generalConnected:false});setAiConnections(current=>current.map(connection=>connection.role==="general"?{...connection,state:"error"}:connection));setShowConnect(true)}finally{setConnecting(false)}}
 // Kral politikayı doğrudan çevirir; General uygulamaz ama görüşünü söyler.
 function setPolicy(key:PolicyKey,value:number){
  if(!game)return;
  const result=applyPolicy(game,{key,value:clampPolicy(key,value)},Date.now());
  setGame(result.game);
  setChat(x=>[...x,{who:generalName,text:result.comment,kind:"general"}]);
  lastCouncilLoaded.current=0;
  setTab("meclis");
  setPanelOpen(true);
 }
 function cancelConstruction(buildingType:string,targetLevel:number){
  if(!game)return;
  const result=applyActions(game,[{name:"cancel_construction",arguments:{building_type:buildingType,target_level:targetLevel}}],Date.now());
  setGame(result.game);
  setToast(result.results[0]??"İnşaat iptal edilemedi.");
 }
 async function answerCoalition(decision:"accept"|"decline"){
  if(coalitionBusy)return;setCoalitionBusy(true);
  try{const response=await fetch("/api/faction-coalition",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({decision})});const data=await response.json() as {game?:Game;revision?:number;demand?:CoalitionDemand|null;error?:string};if(!response.ok)throw new Error(data.error??"Koalisyon masası yanıtlanamadı.");if(data.game)setGame(tick(data.game,Date.now()));if(data.revision!==undefined)revision.current=data.revision;setCoalitionDemand(data.demand??null);setToast(decision==="accept"?"Koalisyonla uzlaşıldı; ferman yürürlüğe girdi.":"Talep geri çevrildi; meydandaki baskı arttı.");}
  catch(error){setToast(error instanceof Error?error.message:"Koalisyon masası yanıtlanamadı.");}finally{setCoalitionBusy(false)}
 }

 async function resolveFate(choice:"discuss"|"defer"){
  if(!fateEvent||fateBusy)return;setFateBusy(true);
  try{
   const response=await fetch("/api/fate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:fateEvent.id,choice})});
   const data=await response.json() as {error?:string};
   if(!response.ok)throw new Error(data.error||"Kader kararı kaydedilemedi.");
   const event=fateEvent;setFateEvent(null);
   if(choice==="discuss"){
    setMessage(event.discussion);setTab("general");setPanelOpen(true);
    setToast("Generalin önüne ikilem bırakıldı; son karar sizde.");
   }else setToast("Bu ikilem şimdilik ertelendi; krallık yine de sonuçlarını yaşamaya devam edecek.");
  }catch(error){setToast(error instanceof Error?error.message:"Kader kararı kaydedilemedi.")}
  finally{setFateBusy(false)}
 }
 async function send(e:React.FormEvent){e.preventDefault();await submitOrder(message)}
 function reset(){if(confirm("Krallığınız hem buluttan hem bu cihazdan silinsin ve yeniden başlansın mı?")){void fetch("/api/save",{method:"DELETE"});if(account)localStorage.removeItem(storeKey(account.id));setGame(null);setSetup("welcome");setCloudStatus("BULUT HAZIR")}}
 async function logout(){await fetch("/api/auth",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"logout"})});if(account)localStorage.removeItem(storeKey(account.id));location.reload()}
 if(!ready)return <div className="boot-screen">DİYAR HAZIRLANIYOR…</div>;
 if(!account)return <AccountGate onAuthenticated={user=>{location.href=user.role==="admin"?"/admin":"/"}}/>;
 if(!game&&account.role==="admin")return <main className="account-gate"><div className="account-landscape"><i/><i/><i/></div><header><div className="brand-mark">♜</div><div className="title-block"><h1>DEMİRKALE</h1><p>YÖNETİCİ OTURUMU</p></div></header><section className="account-card admin-entry"><p className="eyebrow">YÖNETİM YETKİSİ DOĞRULANDI</p><h2>Yönetim Divanı hazır</h2><p>Channelları açıp kapatabilir, sezon ayarlarını belirleyebilir ve oyuncu hesaplarını yönetebilirsin.</p><a className="primary-seal" href="/admin">YÖNETİM DİVANINI AÇ</a><button onClick={logout}>YÖNETİCİ OTURUMUNU KAPAT</button></section></main>;
 if(!game)return <Onboarding channels={availableChannels} step={setup} setStep={setSetup} selected={selected} setSelected={setSelected} name={name} setName={setName} ruler={ruler} setRuler={setRuler} terrain={terrain} setTerrain={setTerrain} provider={provider} setProvider={setProvider} model={model} setModel={setModel} apiKey={apiKey} setApiKey={setApiKey} found={found} connect={connectAndFound} connecting={connecting} error={generalError}/>;
 const activeSection=sectionForTab(tab);
 return <main className={night?"app-shell night":"app-shell"}>{toast&&<button className="toast" onClick={()=>setToast("")}>{toast} ×</button>}{showConnect&&<div className="connect-overlay"><section className="connect-card"><button className="close-connect" onClick={()=>setShowConnect(false)}>×</button><p className="eyebrow">GENERALİ YENİDEN BAĞLA</p><h2>BYOK oturum bağlantısı</h2>{storedByok&&!replaceByok?<div className="stored-key"><b>✓ ANAHTAR HESABINDA KAYITLI</b><span>{storedProvider||provider} · {storedModel||model}</span><label>Model<select value={model} onChange={e=>setModel(e.target.value)}>{modelOptions[provider].map(option=><option value={option.id} key={option.id}>{option.label}</option>)}</select></label><button onClick={()=>setReplaceByok(true)}>ANAHTARI DEĞİŞTİR</button></div>:<div className="form-grid"><label>Sağlayıcı<select value={provider} onChange={e=>{const next=e.target.value as keyof typeof modelOptions;setProvider(next);setModel(modelOptions[next][0].id)}}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option></select></label><label>Model<select value={model} onChange={e=>setModel(e.target.value)}>{modelOptions[provider].map(option=><option value={option.id} key={option.id}>{option.label}</option>)}</select></label><label className="wide">API anahtarı<input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} autoComplete="off" placeholder="API anahtarını gir"/></label></div>}{generalError&&<div className="connection-error">{generalError}</div>}<p className="privacy-note">Anahtar hesabına AES-GCM ile şifreli kaydedilir; tarayıcıya geri gönderilmez ve yalnızca sağlayıcı isteği sırasında çözülür.</p><button className="primary-seal connect-submit" disabled={connecting||((!storedByok||replaceByok)&&!apiKey.trim())} onClick={reconnectGeneral}>{connecting?"DOĞRULANIYOR…":storedByok&&!replaceByok?"KAYITLI BAĞLANTIYLA DEVAM":"BAĞLANTIYI KAYDET"}</button></section></div>}<header className="topbar"><div className="brand-mark"><GameIcon name="krallik" label="Krallık"/></div><div className="title-block"><h1>{game.kingdomName.toLocaleUpperCase("tr")}</h1><p>KRALLIK SİMÜLASYONU</p></div><div className="channel-chip"><span>● AKTİF</span><b>{game.channel}</b><small>Gün 1 · Koruma {left(game.protectionEndsAt,now)}</small></div><button className="ai-connections" onClick={()=>{setTab("meclis");setPanelOpen(true)}} title="Divandaki AI bağlantılarını aç">{aiConnections.map(connection=><span className={connection.state} key={connection.role}><i/>{connection.role==="general"?"GEN":connection.role==="commons"?"HALK":"ASKER"}</span>)}</button><div className="cloud-chip" title={cloudUser||"Hesaba bağlı kayıt"}>☁ {cloudStatus}</div>{account.role==="admin"&&<a className="admin-link" href="/admin">YÖNETİM</a>}<button className="day-toggle" onClick={()=>{setTutorialStep(0);setTab("meclis");setPanelOpen(true)}}>？ REHBER</button><button className="day-toggle" onClick={()=>setNight(x=>!x)}>{night?"☾ GECE":"☀ GÜNDÜZ"}</button><button className="profile-button" onClick={reset}>{game.rulerName} · Sıfırla</button><button className="profile-button" onClick={logout}>Çıkış</button></header>
 <section className="resource-ribbon">{meta.map(([k,label])=><div className="resource" key={k}><span>{label}</span><strong>{fmt(game.resources[k])}</strong><small className={(rt?.[k]??0)<0?"negative":""}>{(rt?.[k]??0)>=0?"+":""}{(rt?.[k]??0).toFixed(1)}/sa</small></div>)}<div className="population"><div className="population-copy"><span>HALKIN RIZASI</span><strong>{Math.round(game.popularity)}</strong><small><b className={`mood ${mood.id}`}>{mood.label}</b><em>{Math.round(game.population)} / {game.capacity} nüfus</em></small></div><div className="population-gauge"><div className="meter"><i className={mood.id} style={{width:`${game.popularity}%`}}/></div><small>RIZA DÜZEYİ</small></div></div></section>
 <section className="world-stage"><KingdomScene night={night} keepLevel={lv} developed={lv>=3&&game.buildings.length>=8} terrain={game.terrain} constructionName={game.constructionQueue?.find(job=>job.startedAt!==null)?.name??(game.queue?.kind==="building"?game.queue.name:undefined)} buildings={game.buildings} population={game.population} capacity={game.capacity} kingdoms={nearbyKingdoms} sharedMine={nearbyMine} army={armySize(game.units)} watchRatio={watchRatioOf(game)} mood={mood.id} autoRotate={autoRotate} seedKey={`${game.kingdomName}|${game.foundedAt}`} onBuildingSelect={type=>setSelectedBuildingType(type)}/><div className="scene-title"><button className="world-view-toggle" onClick={()=>setWorldView(true)}>CHANNEL HARİTASINI AÇ</button><button className={autoRotate?"rotate-toggle spinning":"rotate-toggle"} title={autoRotate?"Kamera dönüşünü durdur":"Kamerayı yeniden döndür"} onClick={()=>setAutoRotate(x=>!x)}>{autoRotate?"⟳ DÖNÜŞ AÇIK":"⏸ DÖNÜŞ DURDU"}</button><span>YENİ BAŞKENT · {(terrainCatalog[game.terrain]??terrainCatalog.plain).label}</span><h2>{game.kingdomName}</h2><p>Kale Sv.{lv} · {game.buildings.length} yapı · {Object.values(game.units).reduce((a,b)=>a+b,0)} asker</p><small>{(terrainCatalog[game.terrain]??terrainCatalog.plain).bonus} · {otherKingdoms.length} komşu sancak genel haritada</small></div>{selectedBuildingType&&(()=>{
  const built=game.buildings.find(item=>item.type===selectedBuildingType);
  const definition=catalog.find(item=>item.type===selectedBuildingType);
  if(!built&&!definition)return null;
  const level=built?.level??(selectedBuildingType==="keep"?lv:0);
  const name=built?.name??definition?.name??selectedBuildingType;
  const next=level>=MAX_BUILDING_LEVEL?"Geliştirme tavanında":`Sonraki adım: Sv.${level+1}`;
  return <aside className="scene-building-card" aria-live="polite"><button className="scene-building-close" onClick={()=>setSelectedBuildingType(null)} aria-label="Yapı bilgisini kapat">✕</button><span>SAHNEDEKİ YAPI</span><h3>{name} · Sv.{level}</h3><p>{definition?.detail??"Krallığın yönetim ve savunma merkezi."}</p><small>{next}</small><button className="scene-building-action" onClick={()=>{setSelectedBuildingType(null);setTab("binalar");setPanelOpen(true)}}>YAPI KARARLARINI AÇ</button></aside>;
 })()}{Boolean(game.channelId)&&(()=>{
  // Rozet yalnızca imza bekleyeni sayıyordu; karşı taraftan gelen ve
  // cevaplanmamış mesaj hiç görünmüyordu, Kral masayı açmadan fark etmiyordu.
  const bekleyen=negotiationTables.filter(table=>table.canAccept
    ||(table.status!=="agreed"&&table.status!=="declined"&&table.messages.length>0&&!table.messages[table.messages.length-1].mine)).length;
  const activeNegotiationId=selectedNegotiationId??negotiationTables[0]?.id??null;
  const özet=(terms:{resource?:string;tributeAmount?:number;tributeRate?:number;hours?:number;everyHours?:number;mercenaryCount?:number;mercenaryFee?:number}|null)=>{
    if(!terms)return "";
    if(terms.mercenaryCount)return `${terms.mercenaryCount} Kiralık Birlik · ${terms.mercenaryFee??0} altın peşin · ${terms.hours??24} saat`;
    const kaynak=(resourceLabels.find(([id])=>id===terms.resource)?.[1]??terms.resource??"altın").toLocaleLowerCase("tr-TR");
    const miktar=terms.tributeAmount?`${terms.tributeAmount} ${kaynak}`:terms.tributeRate?`ambarın %${Math.round(terms.tributeRate*100)}'i`:"";
    return miktar?`${miktar} · her ${terms.everyHours??6} saatte · ${terms.hours??24} saat boyunca`:`${terms.hours??24} saat`;
  };
  return <div className={negotiationOpen?"envoy-dock open":"envoy-dock"}>
   <button className="envoy-tab" onClick={()=>setNegotiationOpen(x=>!x)}>
    <span>⚑</span><b>MÜZAKERE</b>{bekleyen>0&&<i>{bekleyen}</i>}
   </button>
   {negotiationOpen&&<div className="envoy-sheet">
    <div className="envoy-head"><div><span>DİPLOMASİ ÇALIŞMA ALANI</span><b>Müzakere Divanı</b><small>{negotiationTables.length} masa · {agreementList.length} anlaşma</small></div><button onClick={()=>setNegotiationOpen(false)}>SAHNEYE DÖN ✕</button></div>
    {negotiationTables.length>0&&<nav className="negotiation-table-tabs" aria-label="Müzakere masaları">{negotiationTables.map((table,index)=><button className={activeNegotiationId===table.id?"active":""} key={table.id} onClick={()=>setSelectedNegotiationId(table.id)}><span>MASA {index+1}</span><b>{table.counterpart}</b><small>{table.canAccept?"İMZA BEKLİYOR":table.status==="agreed"?"ANLAŞILDI":table.status==="declined"?"KAPANDI":"YAZIŞMA SÜRÜYOR"}</small></button>)}</nav>}
    <div className={envoyAccepts?"envoy-door":"envoy-door shut"}>
     <div><b>{envoyAccepts?"KAPI AÇIK":"KAPI KAPALI"}</b>
      <span>{envoyAccepts
       ?"Yabancı Krallar size masa açabilir. Siz masada değilken Generaliniz o masalara SİZİN anahtarınızla cevap yazar."
       :"Size yeni masa açılamaz. Açık masalar ve sizin açtığınız masalar sürer."}</span></div>
     <button disabled={worldBusy} onClick={()=>void setEnvoyDoor(!envoyAccepts)}>{envoyAccepts?"KAPAT":"AÇ"}</button>
    </div>
    <div className="envoy-new">
     <span>YENİ MASA</span>
     {otherKingdoms.length===0
      ?<p>Bu channel&apos;da müzakere edilecek başka krallık yok.</p>
      :<><div className="envoy-fields">
        <select value={envoyTarget} onChange={event=>setEnvoyTarget(event.target.value)}>
         <option value="">Karşı krallık seç…</option>
         {otherKingdoms.map((kingdom,index)=><option key={kingdom.id} value={kingdom.id}>{index+1}. {kingdom.name??"Bilinmeyen Sancak"}</option>)}
        </select>
        <select value={envoyTopic} onChange={event=>setEnvoyTopic(event.target.value)}>
         <option value="non_aggression">Saldırmazlık</option>
         <option value="tribute">Haraç</option>
         <option value="alliance">İttifak</option>
         <option value="passage">Geçiş izni</option>
         <option value="ultimatum">Ültimatom</option>
         <option value="mercenary">Kiralık birlik</option>
        </select>
       </div>
       <input value={envoyMessage} onChange={event=>setEnvoyMessage(event.target.value)} placeholder="Açılış sözünüz…" maxLength={MAX_MESSAGE_LENGTH}/>
       <button disabled={worldBusy||!envoyTarget||envoyMessage.trim().length<5} onClick={()=>void openNegotiation()}>ELÇİ GÖNDER</button></>}
    </div>
    <p className="envoy-note">Karşı Generalin sözleri onun iddiasıdır, doğrulanmış bilgi değil. Şartı Generaliniz sunar, imzayı siz atarsınız.</p>
    {agreementList.map(deal=><div className="envoy-deal" key={deal.id}>
      <div><b>{deal.iPay?"Ödüyorsunuz":"Tahsil ediyorsunuz"} · {deal.counterpart}</b>
       <span>{özet(deal.terms)} · {deal.paidCount} ödeme yapıldı</span></div>
      <strong>{left(deal.endsAt,now)}</strong></div>)}
    {negotiationTables.filter(table=>table.id===activeNegotiationId).map((table,index)=>{
     // Şart sunulabilir mi sorusunu MOTOR yanıtlar; panelde ikinci bir kopyası
     // yazılsaydı Kral, sunucunun reddedeceği bir düğme görürdü. Kimlik alanları
     // kuralın dışındadır, canProposeTerms yalnızca durum/tur/süreye bakar.
     const asNegotiation:Negotiation={id:table.id,channelId:"",initiatorId:"",targetId:"",topic:table.topic as NegotiationTopic,
      status:table.status as NegotiationStatus,turns:table.turns,proposed:table.proposed as Terms|null,
      proposedBy:table.proposedBy as Side|null,openedAt:0,expiresAt:table.expiresAt,lastTurnAt:0};
     const sunabilir=canProposeTerms(asNegotiation,table.side,true,now).ok;
     const konusabilir=canSpeak(asNegotiation,table.side,now).ok;
     const haracVar=carriesTribute(table.topic as NegotiationTopic),kiralikBirlik=table.topic==="mercenary";
     const form=envoyTerm&&envoyTerm.tableId===table.id?envoyTerm:null;
     const reply=kingReply&&kingReply.tableId===table.id?kingReply:null;
     return <article className={table.canAccept?"envoy-table pending":"envoy-table"} key={table.id}>
      <div className="envoy-title"><b>#{index+1} {table.counterpart}</b><small>{table.status==="awaiting_king"?"ŞART SUNULDU":table.status==="agreed"?"ANLAŞILDI":table.status==="declined"?"REDDEDİLDİ":`${table.turns}/${envoyLimits.maxTurns} söz`}</small></div>
      <div className="envoy-log">{table.messages.slice(-4).map((message,i)=><p className={message.mine?"mine":""} key={i}>{message.body}</p>)}</div>
      {konusabilir&&<div className="envoy-king-reply">
       <span>KRALIN SÖZÜ</span>
       <input value={reply?.text??""} onChange={event=>setKingReply({tableId:table.id,text:event.target.value})} placeholder="Karşı krala cevabınızı yazın…" maxLength={MAX_MESSAGE_LENGTH}/>
       <button disabled={worldBusy||!(reply?.text.trim())} onClick={()=>void replyAsKing(table)}>SÖZÜ GÖNDER</button>
      </div>}
      {table.proposed&&<div className="envoy-terms"><span>SUNULAN ŞART</span><b>{özet(table.proposed)}</b></div>}
      {table.canAccept&&<div className="envoy-actions">
        <button disabled={worldBusy} onClick={()=>void negotiationAction(table.id,"accept")}>ONAYLA</button>
        <button className="ghost" disabled={worldBusy} onClick={()=>void negotiationAction(table.id,"decline")}>REDDET</button>
      </div>}
      {sunabilir&&!form&&<div className="envoy-actions">
        <button className="ghost" onClick={()=>setEnvoyTerm({tableId:table.id,mode:"amount",value:"",resource:"gold",payer:"them",lessor:"them",mercenaryCount:"",mercenaryFee:"",hours:"24",everyHours:"6",note:""})}>KENDİ ŞARTINI SUN</button>
      </div>}
      {sunabilir&&form&&<div className="envoy-term-form">
        {haracVar&&<><div className="envoy-fields">
          <select value={form.payer} onChange={event=>setEnvoyTerm({...form,payer:event.target.value as "us"|"them"})}>
           <option value="them">Karşı taraf öder</option>
           <option value="us">Biz öderiz</option>
          </select>
          <select value={form.resource} onChange={event=>setEnvoyTerm({...form,resource:event.target.value})}>
           {TRIBUTE_RESOURCES.map(id=><option key={id} value={id}>{resourceLabels.find(([key])=>key===id)?.[1]??id}</option>)}
          </select>
         </div>
         <div className="envoy-fields">
          <select value={form.mode} onChange={event=>setEnvoyTerm({...form,mode:event.target.value as "amount"|"rate",value:""})}>
           <option value="amount">Sabit miktar</option>
           <option value="rate">Ambar oranı</option>
          </select>
          <input type="number" min={1} max={form.mode==="rate"?MAX_TRIBUTE_RATE_PERCENT:MAX_TRIBUTE_AMOUNT}
           value={form.value} onChange={event=>setEnvoyTerm({...form,value:event.target.value})}
           placeholder={form.mode==="rate"?`yüzde · en çok ${MAX_TRIBUTE_RATE_PERCENT}`:`birim · en çok ${MAX_TRIBUTE_AMOUNT}`}/>
         </div></>}
        {kiralikBirlik&&<><div className="envoy-fields">
          <select value={form.lessor} onChange={event=>setEnvoyTerm({...form,lessor:event.target.value as "us"|"them"})}>
           <option value="them">Karşı taraf asker verir</option>
           <option value="us">Biz asker veririz</option>
          </select>
          <input type="number" min={1} max={MAX_MERCENARY_COUNT} value={form.mercenaryCount} onChange={event=>setEnvoyTerm({...form,mercenaryCount:event.target.value})} placeholder={`asker sayısı · en çok ${MAX_MERCENARY_COUNT}`}/>
         </div><div className="envoy-fields">
          <input type="number" min={1} max={MAX_MERCENARY_FEE} value={form.mercenaryFee} onChange={event=>setEnvoyTerm({...form,mercenaryFee:event.target.value})} placeholder={`peşin altın · en çok ${MAX_MERCENARY_FEE}`}/>
          <span className="envoy-inline-note">Kayıp, askerleri kiralayan krallığın nüfusuna yazılır.</span>
         </div></>}
        <div className="envoy-fields">
         <input type="number" min={1} max={MAX_HOURS} value={form.hours} onChange={event=>setEnvoyTerm({...form,hours:event.target.value})} placeholder={`süre saat · en çok ${MAX_HOURS}`}/>
         {haracVar&&<input type="number" min={1} max={MAX_HOURS} value={form.everyHours} onChange={event=>setEnvoyTerm({...form,everyHours:event.target.value})} placeholder="ödeme aralığı saat"/>}
        </div>
        <input value={form.note} onChange={event=>setEnvoyTerm({...form,note:event.target.value})} placeholder="Şartın yanına bir söz…" maxLength={MAX_MESSAGE_LENGTH}/>
        <small>{haracVar
         ?(form.mode==="rate"
           ?`Her ödemede ambarın yüzdesi kadarı gider; tavan yüzde ${MAX_TRIBUTE_RATE_PERCENT}. Oran seçiliyken sabit miktar gönderilmez.`
           :`Her ödemede sabit miktar gider; tavan ${MAX_TRIBUTE_AMOUNT} birim. Sabit miktar seçiliyken oran gönderilmez.`)
         :kiralikBirlik?"Bedel imzada bir kez ödenir. Birlik kiracının garnizonunda savaşır; süre sonunda sağ kalanlar kiralayanın nüfusuna döner."
         :"Bu konu haraç taşımaz; yalnızca süre konuşulur."}</small>
        <div className="envoy-actions">
         <button disabled={worldBusy||(haracVar&&!(Number(form.value)>0))||(kiralikBirlik&&(!(Number(form.mercenaryCount)>0)||!(Number(form.mercenaryFee)>0)))} onClick={()=>void proposeTerms(table)}>ŞARTI SUN</button>
         <button className="ghost" disabled={worldBusy} onClick={()=>setEnvoyTerm(null)}>VAZGEÇ</button>
        </div>
      </div>}
    </article>})}
   </div>}
   {selectedOperation==="spy_network"&&<div className="operation-builder spy-network-builder"><header><button onClick={()=>setSelectedOperation(null)}>← OPERASYONLARA DÖN</button><h3>Casus ağı kurma planı</h3></header><div className="builder-steps"><b>1 · Operasyon</b><b>2 · Hedef</b><b>3 · Süre ve risk</b><b>4 · General</b></div><div className="builder-layout"><section className="target-list"><span>ÖNCEDEN KEŞFEDİLMİŞ HEDEFİ SEÇ</span>{otherKingdoms.map(kingdom=><button key={kingdom.id} className={operationTarget===kingdom.id?"selected":""} onClick={()=>setOperationTarget(kingdom.id)} disabled={!kingdom.report}><b>{kingdom.name??"Bilinmeyen Sancak"}</b><small>{kingdom.report?kingdom.network?.status==="active"?"Ağ etkin · rapor güncel":kingdom.network?.status==="deploying"?"Ağ yolda":"Keşif raporu mevcut":"Önce başarıyla keşfedilmeli"}</small></button>)}</section><aside className="operation-plan"><h4>{otherKingdoms.find(item=>item.id===operationTarget)?.name??"Haritadan keşfedilmiş hedef seç"}</h4><div className="target-intel"><b>Yöntem</b><span>Ağ hedefte yerleşir, sonra kamuya açık kale, nüfus, ordu ve yapı bilgisini düzenli yeniler. Ambar, maaş ve kesin halk rızası asla sızmaz.</span></div><dl><div><dt>Yerleşme</dt><dd>{SPY_NETWORK.deploymentMinutes} oyun dakikası</dd></div><div><dt>Rapor ritmi</dt><dd>Her {SPY_NETWORK.reportHours} oyun saatinde</dd></div><div><dt>Açığa çıkma</dt><dd>Karşı-istihbarat nöbetinde kesin</dd></div><div><dt>Maliyet</dt><dd>{SPY_NETWORK.goldCost} altın</dd></div></dl><div className="plan-actions"><button onClick={()=>{setMessage("Casus ağının getireceği bilgi ile açığa çıkma riskini değerlendir.");setTab("general")}}>GENERALLE İSTİŞARE ET</button><button disabled={worldBusy||!operationTarget||!otherKingdoms.some(item=>item.id===operationTarget&&item.report)} onClick={()=>void worldAction("spy_network",operationTarget)}>AĞI KUR</button></div></aside></div></div>}
  </div>})()}
<button className="market-launcher" onClick={()=>setMarketOpen(true)}><span>⚖</span><b>PAZAR</b></button>
{marketOpen&&<MarketWorkspace
 game={game}
 now={now}
 channelIndex={channelIndex??undefined}
 connecting={connecting}
 formatLeft={at=>left(at,now)}
 onClose={()=>setMarketOpen(false)}
 onSubmit={order=>void submitOrder(order)}
/>}
{(()=>{const job=game.constructionQueue?.find(item=>item.startedAt!==null)||game.queue;return job?<div className="active-queue"><span>{"kind" in job&&job.kind==="unit"?"EĞİTİM DEVAM EDİYOR":"⚒ HARİTADA İNŞAAT"}</span><b>{job.name}</b><strong>{left(job.completesAt??now,now)}</strong><div className="queue-progress"><i style={{width:`${job.startedAt?Math.max(4,Math.min(100,(now-job.startedAt)/((job.completesAt??now)-job.startedAt)*100)):8}%`}}/></div></div>:null})()}
 {panelOpen&&<aside className="council-panel"><div className="panel-toolbar"><b>{activeSection.label}</b><button onClick={()=>setPanelOpen(false)}>← SAHNEYE DÖN</button></div><div className="general-bars">{[["Sadakat",game.loyalty],["Halkın Rızası",Math.round(game.popularity)],["İtibar",game.reputation]].map(([label,value])=><div className="stat" key={label}><span>{label}</span><div><i style={{width:`${value}%`}}/></div><b>{value}</b></div>)}</div>{activeSection.tabs.length>1&&<nav className="section-tabs" aria-label={`${activeSection.label} bölümleri`}>{activeSection.tabs.map(item=><button key={item.id} className={tab===item.id?"active":""} onClick={()=>setTab(item.id)}>{item.icon&&<GameIcon name={item.icon}/>}<span>{item.label}</span></button>)}</nav>}<div className="panel-content">
 {tab==="meclis"&&(()=>{const ration=rationsOf(game),primary=populaceDemands[0],foodRate=rt?.food??0;
  const decisionTitle=primary?.text??(ration.food<100?"Yiyecek istihkakını yeniden değerlendir":"Krallığın öncelikli kararını belirle");
  const fallback:Record<"commons"|"garrison"|"general",string>={
   commons:populaceDemands.find(item=>item.voice==="commons")?.text??`Halkın bugün açık talebi yok; ${mood.label.toLocaleLowerCase("tr-TR")} düzenin korunmasını bekliyor.`,
   garrison:populaceDemands.find(item=>item.voice==="garrison")?.text??((game.soldierUnrest??0)>=30?"Kışlada huzursuzluk büyüyor; maaş ve disiplin yeniden ele alınmalı.":"Kışla sakin; garnizon nöbet ve eğitim emirlerine hazır."),
   general:generalRequests[0]?.text??(foodRate>=0?"Üretim dengesi hareket alanı sağlıyor; bir sonraki karar rıza ve savunmayı birlikte büyütmeli.":"Önce yiyecek açığını kapatın; aksi hâlde yeni yükümlülük sürdürülemez."),
  };
 const scheduledCouncilAt=councilBriefing?.callDueAt??councilBriefing?.nextAt??null;
 const scheduleText=councilBriefing?.callDueAt
  ? `Kralın çağrısı kayda alındı · Divan ${scheduledCouncilAt&&scheduledCouncilAt<=now?"yakında":scheduledCouncilAt?left(scheduledCouncilAt,now)+" sonra":"hazırlanıyor"}${scheduledCouncilAt?` · ${councilTime(scheduledCouncilAt)}`:""}`
  : councilBriefing
   ? `Son Divan ${councilPast(councilBriefing.generatedAt,now)} · sonraki olağan Divan ${scheduledCouncilAt?(scheduledCouncilAt<=now?"yakında":left(scheduledCouncilAt,now)+" sonra"):"takvimleniyor"}${scheduledCouncilAt?` · ${councilTime(scheduledCouncilAt)}`:""}`
 : "Henüz Divan kaydı yok; Kral toplantı çağrısı yapabilir.";
 const callLocked=councilBusy||Boolean(councilBriefing&&!councilBriefing.readAt)||Boolean(councilBriefing?.callDueAt);
 const sessionLabel=councilBriefing?.sessionStage==="opening"?"Açılış sözleri kayda geçti":councilBriefing?.sessionStage==="moderation"?"General oturumu yönetiyor":councilBriefing?.sessionStage==="reply"?"Halk ve Garnizon karşılık veriyor":"Divan sonucu hazır";
 const sessionInProgress=Boolean(councilBriefing&&councilBriefing.sessionStage!=="concluded");
 return <div className="court-workspace"><header className="page-heading council-heading"><div><span>KRALİYET DİVANI · ÜÇ BAĞIMSIZ GÖRÜŞ</span><h3>{primary?"Açık talep":"Divan gündemi"}</h3></div><div className="council-schedule"><div><p>{councilBriefing?.readAt?"Gündem okundu. Kralın bağlayıcı kararları Defter akışında saklanır.":"Halk, Garnizon ve General aynı durumu kendi çıkarları açısından değerlendirir."}</p><small>{scheduleText}</small></div><div className="council-actions"><button className="call-council" disabled={callLocked} onClick={()=>void callCouncil()}>{councilBusy?"KAYDEDİLİYOR…":councilBriefing?.callDueAt?"TOPLANTI ÇAĞRILDI":"DİVANI TOPLA"}</button><button disabled={councilBusy||Boolean(councilBriefing?.readAt)||sessionInProgress} onClick={()=>void acknowledgeCouncil()}>{councilBusy?"İŞARETLENİYOR…":sessionInProgress?"OTURUM SÜRÜYOR":councilBriefing?.readAt?"OKUNDU · YENİ DİVAN BEKLENİYOR":"OKUDUM · GÜNDEMİ KAPAT"}</button></div></div></header>{councilError&&<div className="council-error">{councilError}</div>}{councilBriefing?.callDueAt&&<section className="council-call-status" aria-live="polite"><div><span>KRALIN TOPLANMA EMRİ</span><h4>{councilBriefing.callDueAt<=now?"Divan gündemi hazırlanıyor":"Divan toplanma sırasına alındı"}</h4><p>{councilBriefing.callDueAt<=now?"Saray kâtipleri Halkın, Garnizonun ve Generalin görüşlerini bir araya getiriyor.":"Çağrın kayda geçti. Belirlenen vakitte üç kesim yeni gündemini Kralın önüne getirecek."}</p></div><div className="council-call-clock"><b>{councilTime(councilBriefing.callDueAt)}</b><small>{councilBriefing.callDueAt<=now?"Toplanma vakti geldi":"Toplantıya " + left(councilBriefing.callDueAt,now)}</small></div></section>}{councilBriefing?.discussion.length? <section className="council-live-session"><header><div><span>CANLI DİVAN OTURUMU</span><h4>{sessionLabel}</h4></div><b>{sessionInProgress&&councilBriefing.sessionNextAt?`SONRAKİ SÖZ · ${left(councilBriefing.sessionNextAt,now)}`:"GENERALİN SONUCU"}</b></header><div className="council-transcript">{councilBriefing.discussion.map((line,index)=><article className={line.role} key={`${line.at}-${index}`}><span>{line.phase==="opening"?"İLK SÖZ":line.phase==="moderation"?"GENELİN YÖNETİMİ":line.phase==="reply"?"KARŞILIK":"SONUÇ"}</span><b>{line.speaker}</b><p>{line.text}</p></article>)}</div></section>:null}{fateEvent&&<section className="fate-event" aria-label="Kader ANI"><span>KADER ANI · GENERALİN İKİLEMİ</span><h4>{fateEvent.title}</h4><p>{fateEvent.text}</p><small>General: “{fateEvent.discussion}”</small><footer><button disabled={fateBusy} onClick={()=>void resolveFate("discuss")}>{fateBusy?"MÜHÜRLENİYOR…":"GENERALE GÖTÜR"}</button><button disabled={fateBusy} onClick={()=>void resolveFate("defer")}>ŞİMDİLİK ERTELE</button></footer></section>}<div className="ai-council-grid">
   {(["commons","garrison","general"] as const).map(role=>{const voice=councilVoices.find(item=>item.role===role),connection=aiConnections.find(item=>item.role===role),text=voice?.text??fallback[role],speaker=role==="commons"?"HALK MECLİSİ":role==="garrison"?"GARNİZON":generalName,connectionLine=connection?.detail??(connection?.provider&&connection.model?`${connection.provider} · ${connection.model}`:"Model bağlı değil; deterministik görüş gösteriliyor.");return <article className={`ai-council-card ${role} ${voice?.priority??"steady"}`} key={role}><header><div><span>{role==="general"?"KOMUTA GÖRÜŞÜ":role==="commons"?"HALKIN GÖRÜŞÜ":"KIŞLANIN GÖRÜŞÜ"}</span><b>{speaker}</b></div><em className={connection?.state??"fallback"}><i/>{connection?.state==="connected"?"AI AKTİF":connection?.state==="error"?"BAĞLANTI HATASI":"KURAL YEDEĞİ"}</em></header><p>{councilBusy&&!voice?"Durumu inceliyor…":text}</p><small title={connectionLine}>{connectionLine}</small></article>})}
  </div><section className="council-history-preview"><div className="section-head"><span>SON ÜÇ DİVAN TOPLANTISI</span><b>{councilMeetings.length?`${councilMeetings.length} KAYIT`:"HENÜZ KAYIT YOK"}</b></div>{councilMeetings.length?<CouncilMeetingList meetings={councilMeetings}/>:<p className="council-history-empty">İlk toplantı oluştuğunda burada saklanacak.</p>}</section><div className="court-decision"><article className="decision-document"><div className="document-seal"><GameIcon name="divan"/></div><span>DİVAN BELGESİ · CANLI DURUM</span><h3>{decisionTitle}</h3><p>İstihkak %{ration.food}; net yiyecek üretimi saatte {foodRate>=0?"+":""}{foodRate.toFixed(1)}. Üç görüş kararın yerine geçmez; önündeki çıkar çatışmasını görünür kılar.</p><div className="document-facts"><div><b>{fmt(game.resources.food)}</b><span>AMBARDaki YİYECEK</span></div><div><b>{foodRate>=0?"+":""}{foodRate.toFixed(1)}</b><span>SAATLİK NET ÜRETİM</span></div><div><b>{Math.round(game.popularity)}</b><span>HALKIN RIZASI</span></div></div><div className="decision-options"><button disabled={ration.food>=100} onClick={()=>setPolicy("foodRation",100)}><div><b>Tam istihkaka dön</b><span>Rıza toparlanır; ambar artış hızı azalır.</span></div><em>{foodRate>=0?"UYGULANABİLİR":"ÜRETİM RİSKLİ"}</em></button><button onClick={()=>{setMessage("Divandaki üç görüşü karşılaştır ve bana uygulanabilir seçenekleri söyle.");setTab("general")}}><div><b>Görüşleri Generalle tartış</b><span>Son karardan önce çıkar çatışmalarını ve riskleri karşılaştır.</span></div><em>İSTİŞARE ET</em></button></div></article></div></div>;})()}
 {tab==="general"&&<div className="council-content"><header className="page-heading general-page-heading"><div><span>GENERALLE İSTİŞARE</span><h3>Karar üzerine konuş</h3></div><p>General krallığın canlı defterini görür; önerir, rutin emirleri uygular ve ağır riskte gerekçe ister.</p></header><div className="advisor"><div className="portrait"><GameIcon name="general" label="General"/></div><div><h3>{game.generalConnected?generalName:"General sessiz"}</h3><p>{game.generalConnected?`${game.provider} · ${game.model}`:"BYOK bağlantısı bekleniyor"}</p></div>{!game.generalConnected&&<button className="reconnect-button" onClick={()=>{setGeneralError("");setShowConnect(true)}}>BAĞLA</button>}<span className={game.generalConnected?"online":"offline"}>●</span></div><div className="council-chips">
  <button onClick={()=>setInfoPanel("hedef")}>◆ İlk hedef</button>
  <button onClick={()=>setInfoPanel("yetki")}>◆ Generalin yetkileri</button>
 </div>{generalRequests.length>0&&<div className="general-requests">
  <span className="requests-head">GENERALİN TALEPLERİ</span>
 {generalRequests.map(request=><div key={request.id} className={`request ${request.severity}`}>
   <p>{request.text}</p>
   <button disabled={connecting} onClick={()=>void submitOrder(`Talebini karşılamak istiyorum: ${request.text}`)}>KARŞILA</button>
 </div>)}
 </div>}
 {peoplePulse&&<section className={`people-pulse ${peoplePulse.riskLevel}`}><span>HALKIN NABZI · KARAR ÖNCESİ</span><b>{peoplePulse.label}</b><p>{peoplePulse.note}</p><small>Bu bir veto değil; Generalin teyit istediği kararın toplumsal yönünü gösterir.</small></section>}
 {/* Balonun kimliği artık adından DEĞİL `kind` alanından okunur; halkın sesi
     General'in balonundan görsel olarak da ayrıdır. Halkın cümlesi
     `RichMessage`'tan geçmez, ham metin olarak basılır: o metin Halk-AI ürünü
     ve markdown biçimlendirmesiyle (kalın başlık, tablo) Kral'ın gözünde
     kendine General'in yetkisine benzer bir ağırlık kurmasına gerek yok —
     halk tek cümleyle konuşur. */}
 <div className="chat-log">{chat.map((x,i)=>x.kind==="populace"
   ?<div className={`message populace ${x.voice??"commons"}`} key={i}><b>{x.who}</b><em>ACİL</em><p>{x.text}</p><small>{"General'in ağzından değil, doğrudan Kral'a. Karşılıksız kalırsa muhalefete akar."}</small></div>
   :<div className={x.kind==="king"?"message king":"message"} key={i}><b>{x.who}</b><RichMessage text={x.text}/></div>)}{connecting&&<div className="message thinking"><b>GENERAL ALDRIC</b><p>Haritayı ve defterleri inceliyor…</p></div>}<div ref={chatEnd}/></div><form className="chat-form" onSubmit={send}><input value={message} onChange={e=>setMessage(e.target.value)} placeholder="Generalinize buyruğunuzu iletin…" disabled={connecting}/><button disabled={connecting}>✦</button></form></div>}
 {tab==="binalar"&&(()=>{const secenekler=buildOptions(game),carpan=materialScaleOf(game.speed);
   const constructionJobs=game.constructionQueue??(game.queue?.kind==="building"?[{type:game.queue.type,name:game.queue.name,targetLevel:game.queue.targetLevel??1,reserved:{},queuedAt:game.queue.startedAt??now,startedAt:game.queue.startedAt??null,completesAt:game.queue.completesAt,durationMs:Math.max(1,game.queue.completesAt-(game.queue.startedAt??now))}]:[]);
   const activeJobs=constructionJobs.filter(job=>job.startedAt!==null),slots=constructionSlots(lv);
   const levelOf=(type:string)=>game.buildings.find(building=>building.type===type)?.level??0;
   const resourceName=(key:string)=>resourceLabels.find(([id])=>id===key)?.[1].toLocaleLowerCase("tr-TR")??key;
   const costText=(cost:Record<string,number>)=>Object.entries(cost).map(([key,value])=>`${value} ${resourceName(key)}`).join(" · ");
   const rations=rationsOf(game);
   const chains=[
    {id:"food",nodes:[
     {type:"wheat_farm",label:"Buğday Tarlası",detail:`Net ${(rt?.food??0)>=0?"+":""}${(rt?.food??0).toFixed(1)} yiyecek/sa`},
     {type:"mill",label:"Değirmen",detail:levelOf("mill")?catalog.find(item=>item.type==="mill")?.detail??"Tarla üretimini güçlendirir":"Üretim çarpanı eksik"},
     {type:"need",label:"Halk istihkakı",detail:`%${rations.food} · rıza ve nüfus`},
    ]},
    {id:"wood",nodes:[
     {type:"lumberjack",label:"Oduncu",detail:`Net ${(rt?.wood??0)>=0?"+":""}${(rt?.wood??0).toFixed(1)} odun/sa`},
     {type:"warehouse",label:"Depo",detail:"Odun ve taş tavanı"},
     {type:"growth",label:"Yeni yapılar",detail:`${secenekler.length} gelişim seçeneği`},
    ]},
    {id:"iron",nodes:[
     {type:"mine",label:"Maden",detail:`Net ${(rt?.iron??0)>=0?"+":""}${(rt?.iron??0).toFixed(1)} demir/sa`},
     {type:"barracks",label:"Kışla",detail:"Mızrakçı eğitimi"},
     {type:"army",label:"Savunma",detail:`${game.units.spearman??0} asker · nöbet ve akın`},
    ]},
   ];
   const cards=[
    {type:"keep",name:"Kale",category:"Yönetim",unlock:1,detail:"İdari kapasite ve yeni yapıların kilidi",current:lv,cost:secenekler.find(option=>option.type==="keep")?.cost??{}},
    ...catalog.map(item=>({...item,current:levelOf(item.type),cost:secenekler.find(option=>option.type===item.type)?.cost??{}})),
   ];
   return <div className="buildings-workspace"><div className="section-head"><span>KRALLIK · BİNALAR</span><b>{activeJobs.length?`${activeJobs.length}/${slots} şantiye çalışıyor`:`${game.buildings.length} yapı · ${carpan>1?`malzeme ×${carpan}`:"şantiye boş"}`}</b></div><div className="buildings-scroll">
    <header className="buildings-heading"><div><span>ÜRETİM VE GELİŞİM</span><h3>Binalar</h3></div><p>Üretim zinciri neden-sonuç ilişkisini gösterir; kartlar mevcut seviyeyi ve sıradaki gelişimi açıklar.</p></header>
    <section className="royal-works" aria-label="Kraliyet işleri">
     <header><div><span>KRALİYET İŞLERİ</span><h3>İnşaat ve eğitim</h3></div><p>Kale Sv.{lv} aynı anda {slots} şantiyeyi yürütür. İşler sırayla başlar; ayrılan kaynaklar iptal edilirse eksiksiz geri döner.</p></header>
     <div className="royal-work-lanes"><article><div className="work-lane-head"><b>İNŞAAT</b><small>{activeJobs.length}/{slots} şantiye · {constructionJobs.length} iş</small></div>{constructionJobs.length?constructionJobs.map((job,index)=><div className={job.startedAt===null?"work-row waiting":"work-row active"} key={`${job.type}-${job.targetLevel}`}><div><b>{job.name}</b><span>{job.startedAt===null?`${index+1}. sırada · kaynak ayrıldı`:`Çalışıyor · ${left(job.completesAt??now,now)} kaldı`}</span></div><button onClick={()=>cancelConstruction(job.type,job.targetLevel)}>İPTAL ET</button></div>):<p className="work-empty">Açık inşaat yok. Generalin onayladığı iş, boş şantiye varsa hemen başlar; yoksa sıraya eklenir.</p>}</article><article><div className="work-lane-head"><b>ASKER EĞİTİMİ</b><small>{game.trainingQueue?"Kışla çalışıyor":"Kışla boş"}</small></div>{game.trainingQueue?<div className="work-row active"><div><b>{game.trainingQueue.name}</b><span>Eğitim sürüyor · {left(game.trainingQueue.completesAt,now)} kaldı</span></div></div>:<p className="work-empty">Eğitim hattı boş. Kışladaki eğitim inşaattan bağımsız ilerler.</p>}</article></div>
    </section>
    <div className="build-layout"><section className="chain-board"><h3>Üretim zincirleri</h3>{chains.map(chain=><div className={`chain-lane ${chain.id}`} key={chain.id}>{chain.nodes.map((node,index)=>{const level=["need","growth","army"].includes(node.type)?1:levelOf(node.type),ready=level>0;return <Fragment key={node.type}>{index>0&&<i>→</i>}<div className={ready?"chain-node ready":"chain-node"}><b>{node.label}{!["need","growth","army"].includes(node.type)&&` · ${level?`Sv.${level}`:"Kurulmadı"}`}</b><small>{node.detail}</small></div></Fragment>})}</div>)}</section>
     <section className="building-list" aria-label="Yapı kartları">{cards.map(item=>{const locked=item.unlock>lv,maxed=item.current>=MAX_BUILDING_LEVEL,jobs=constructionJobs.filter(job=>job.type===item.type),planned=Math.max(item.current,...jobs.map(job=>job.targetLevel)),inQueue=jobs.length>0;const state=inQueue?`${jobs.some(job=>job.startedAt!==null)?"İnşaatta":"Sırada"} · hedef Sv.${planned}`:maxed?"Tavan":locked?`Kale Sv.${item.unlock} gerekli`:item.current?`Sv.${item.current}`:"Kurulmadı";return <article className={`building-tile ${item.current?"built":""} ${locked?"locked":""}`} key={item.type}><div><span>{item.category}</span><b>{item.name} · {state}</b><p>{locked?`Kale Sv.${item.unlock} olmadan planlanamaz.`:item.detail}</p><small>{maxed?`Sv.${MAX_BUILDING_LEVEL} geliştirme tavanı`:costText(item.cost as Record<string,number>)||"Maliyet hesaplanıyor"}</small></div><button disabled={locked||maxed||connecting} onClick={()=>void submitOrder(planned?`${item.name} yapısını Sv.${planned+1} seviyesine yükselt ve inşaat sırasına ekle.`:`${item.name} yapısını kur ve inşaat sırasına ekle.`)}>{maxed?"TAVAN":locked?"KİLİTLİ":inQueue?"SIRAYA EKLE":"GENERALE İLET"}</button></article>})}</section>
    </div>
   </div></div>})()}
 {tab==="pazar"&&<MarketWorkspace embedded game={game} now={now} channelIndex={channelIndex??undefined} connecting={connecting} formatLeft={at=>left(at,now)} onClose={()=>setTab("binalar")} onSubmit={order=>void submitOrder(order)}/>}
 {tab==="halk"&&(()=>{const r=rationsOf(game),army=armySize(game.units),demand=hourlyDemand(game),unrest=Math.round(game.soldierUnrest??0),populationPerDay=populationChange(mood,game.population,game.capacity,game.buildings,24),pressure=Math.round(factionPressureOf(game)),workers=Math.round(game.mineWorkers??0),civilians=Math.max(0,Math.round(game.population)-army-workers);
  const daily=(v:number)=>Math.round(v*24),brewery=game.buildings.some(b=>b.type==="brewery");
  const amenity=(type:string)=>game.buildings.find(b=>b.type===type)?.level??0;
  const step=(current:number,delta:number)=>Math.max(0,Math.min(200,current+delta));
  return <div className="populace-panel">
   <div className="section-head"><span>HALKIN DURUMU · RAPOR</span><b className={`mood ${mood.id}`}>{mood.label}</b></div>
   <header className="page-heading"><div><span>NÜFUS VE RIZA</span><h3>Halk</h3></div><p>Genel göstergeler, gerçek toplumsal kesimler ve rızayı etkileyen somut sorunlar aynı sayfada.</p></header>
   <div className="people-overview"><div><span>HALKIN RIZASI</span><b>{Math.round(game.popularity)}</b><small>{mood.label}</small></div><div><span>NÜFUS</span><b>{Math.round(game.population)}</b><small>{game.capacity} kapasite</small></div><div><span>GÜNLÜK DEĞİŞİM</span><b>{populationPerDay>=0?"+":""}{Math.round(populationPerDay)}</b><small>Göç ve doğum</small></div><div><span>BOŞ KONUT</span><b>{Math.max(0,Math.floor(game.capacity-game.population))}</b><small>kişilik alan</small></div></div>
   <div className="people-layout"><section className="social-groups"><article><i>♧</i><div><b>Üretici halk</b><span>{civilians} kişi · istihkak ve vergiye duyarlı</span></div><em className={game.popularity<45?"warn":""}>{mood.label}</em></article><article><i>⛏</i><div><b>Ortak sahadaki işçiler</b><span>{workers} kişi · üretimden ayrılmış durumda</span></div><em>{workers?"ÇALIŞIYOR":"YOK"}</em></article><article><i>⚔</i><div><b>Garnizon</b><span>{army} asker · maaş ve güvenlik beklentisi</span></div><em className={unrest>=30?"warn":""}>{unrest>=60?"FİRAR RİSKİ":unrest>=30?"TEDİRGİN":"SAKİN"}</em></article><article><i>♜</i><div><b>İç muhalefet</b><span>Baskı {pressure}/100 · rıza düştükçe örgütlenir</span></div><em className={pressure>=30?"warn":""}>{factionState(pressure).label}</em></article></section><section className="people-issues">{populaceDemands.length?populaceDemands.map(item=><article key={item.kind}><i>!</i><div><b>{item.voice==="garrison"?"Garnizon talebi":"Halk talebi"}</b><span>{item.text}</span></div><em>{item.severity==="urgent"?"ACİL":"AÇIK"}</em></article>):<article><i>✓</i><div><b>Açık talep yok</b><span>Hiçbir sorun süre eşiğini aşmadı.</span></div><em>SORUN YOK</em></article>}<article><i>⌂</i><div><b>Konut durumu</b><span>{Math.max(0,Math.floor(game.capacity-game.population))} kişilik boş kapasite bulunuyor.</span></div><em>{game.capacity>game.population?"UYGUN":"DOLU"}</em></article>{game.warDisruption&&game.warDisruption.until>now&&<article><i>⚑</i><div><b>Savaşın izi</b><span>Şehir üretimi %{Math.round(game.warDisruption.productionPenalty*100)} aksıyor; toparlanmaya {left(game.warDisruption.until,now)} var.</span></div><em className="warn">SAVAŞ HASARI</em></article>}{agitation.sentToday>0&&<article><i>⚑</i><div><b>Dolaylı faaliyet bütçesi</b><span>Bugün {agitation.sentToday}/{agitation.perDay} operasyon gönderildi.</span></div><em>DIŞ SİYASET</em></article>}</section></div>
   <div className="general-only-note"><b>Ferman senin, uygulama Generalin</b><span>Vergi ve istihkakları doğrudan çevirirsin; General uygulamaz ama her değişiklikte görüşünü söyler. Asker maaşı ve yapılar emirle yürür.</span></div>

   {/* HALKIN SESİ — var olan bir cezanın okunması, yeni bir ceza değil.
       Talepler sunucudan gelir (süre şartının defteri orada); Kral General'le
       konuştukça tazelenir. Halka emir verilmez: kapatmanın tek yolu yönetimdir. */}
   <div className="populace-voice">
    <div className="section-head"><span>HALKIN SESİ</span><b>{populaceDemands.length?`${populaceDemands.length} açık talep`:"Sessiz"}</b></div>
    {populaceDemands.length
      ? <>{populaceDemands.map(demand=><article key={demand.kind} className={`voice-row ${demand.severity} ${demand.voice}`}>
          <span>{demand.voice==="garrison"?"KIŞLA":"HALK"}</span>
          <div><b>{demand.text}</b><small>{(()=>{const hours=Math.floor((now-demand.since)/3_600_000);return hours<1?"Az önce dile geldi.":hours<24?`${hours} saattir bekliyorlar.`:`${Math.floor(hours/24)} gündür bekliyorlar.`})()}</small></div>
          {demand.severity==="urgent"&&<em>ACİL</em>}
        </article>)}
        <p className="mood-explain-note">Bu talepler bir dilekçe süreci değil: ceza ya da bastırma aracı yoktur. Kapanmalarının tek yolu istihkak, vergi, fiyat, konut ve şenlik kararlarıdır.</p></>
      : <p className="mood-explain-note">Halkın Kraldan açık bir isteği yok. Talep ancak bir eşik saatlerce aşılı kalırsa açılır; anlık dalgalanma masaya gelmez.</p>}
   </div>

   <div className="populace-feed" aria-label="Halk güncesi">
    <div className="section-head"><span>MEYDAN GÜNCESİ</span><b>{populaceFeed.length?"Halkın gündemi":"Sessiz meydan"}</b></div>
    {populaceFeed.length
      ? <div className="feed-list">{populaceFeed.map(item=><article key={item.id}><i>◦</i><div><p>{item.text}</p><small>{(()=>{const hours=Math.max(0,Math.floor((now-item.createdAt)/3_600_000));return hours<1?"Az önce meydanda konuşuldu.":hours<24?`${hours} saat önce konuşuldu.`:`${Math.floor(hours/24)} gün önce konuşuldu.`})()}</small></div></article>)}</div>
      : <p className="mood-explain-note">Meydanda yeni bir gündem yok. Halk-AI bağlı olduğunda, değişen koşullar saatlik turda kısa bir günce notuna dönüşür.</p>}
   </div>

   {/* İÇ MUHALEFET — Kralın bastıracağı bir düğme YOK; yalnızca rızayı yükseltmek
       eritir. Blok bu yüzden bir emir sunmuyor, durumu ve tek çıkışı söylüyor. */}
   {(()=>{const pressure=factionPressureOf(game),state=factionState(pressure);
    if(state.id==="none")return null;
    return <div className={`faction-block ${state.id}`}>
     <div className="section-head"><span>İÇ MUHALEFET</span><b>{state.label}</b></div>
     <div className="faction-gauge"><i style={{width:`${Math.min(100,Math.round(pressure))}%`}}/></div>
     <small>Baskı {Math.round(pressure)} · {state.note}</small>
     {pressure>=FACTION_THRESHOLDS.organized&&<p className="faction-leader">Elebaşı: <b>{factionLeaderName(game.kingdomName,game.foundedAt)}</b></p>}
     <p className="faction-warning">Muhalefet güçle bastırılamaz: askerin zapt gücünü zayıflatan şeyin kendisidir. Tek çıkış halkın rızasını yükseltmektir — istihkak, vergi, fiyat ve konut.</p>
     {coalitionDemand&&<section className="coalition-table" aria-label="Muhalefet koalisyon masası"><div><span>KOALİSYON MASASI</span><b>{factionLeaderName(game.kingdomName,game.foundedAt)} söz istiyor</b></div><p>{coalitionDemand.text}</p><small>{coalitionDemand.policyKey==="taxRate"?`Vergi oranı %${coalitionDemand.policyValue}'e iner.`:`Yiyecek istihkakı %${coalitionDemand.policyValue}'e çıkar.`}{coalitionDemand.refusalCount>0?` · Bu talep ${coalitionDemand.refusalCount} kez geri çevrildi.`:""}</small><footer><button disabled={coalitionBusy} onClick={()=>void answerCoalition("accept")}>{coalitionBusy?"MÜHÜRLENİYOR…":"KABUL ET VE FERMANI MÜHÜRLE"}</button><button disabled={coalitionBusy} onClick={()=>void answerCoalition("decline")}>REDDET</button></footer></section>}
    </div>})()}

   <section className="referendum-result" aria-label="Halk oylaması">
    <div className="section-head"><span>HALK OYLAMASI</span><b>{referendum?"Son sonuç":"Bağlayıcı değil"}</b></div>
    {referendum?<article className={referendum.verdict}><span>{referendum.question}</span><b>DESTEK %{referendum.support}</b><p>{referendum.text}</p><small>{referendum.verdict==="supported"?"Çoğunluk destekliyor; son karar yine Kralın.":referendum.verdict==="opposed"?"Çoğunluk karşı çıkıyor; son karar yine Kralın.":"Halk bölünmüş; son karar yine Kralın."}</small></article>:<p>General aracılığıyla vergi veya istihkak kararını halka sorabilirsin. Sonuç öneridir; hiçbir ferman kendiliğinden uygulanmaz.</p>}
    <button onClick={()=>{setMessage("Halkın bu vergi ve istihkak düzeni hakkındaki görüşünü referandumla soralım.");setTab("general");setPanelOpen(true)}}>GENERALE HALKA SOR</button>
   </section>

   <div className="mood-explain">
    <div><span>Üretim çarpanı</span><b>×{mood.production.toFixed(2)}</b></div>
    <div><span>Nüfus</span><b>{Math.round(game.population)} / {game.capacity}</b></div>
    <div><span>Günlük yiyecek ihtiyacı</span><b>{daily(game.population*NEED.food)}</b></div>
   </div>

   {(()=>{const perDay=populationChange(mood,game.population,game.capacity,game.buildings,24);
     const room=Math.floor(game.capacity-game.population),joined=Math.round(game.peopleJoined??0),lost=Math.round(game.peopleLeft??0);
     const options=[
      {ok:game.popularity>=45&&room>=8,label:"Göçmen çağır",detail:`220 altın + 320 yiyecek · ${Math.max(8,Math.round(game.population*.25))} kişi getirir`,
       why:room<8?"Boş konut yok; önce kapasite büyütün.":game.popularity<45?`Rıza ${Math.round(game.popularity)}; kimse taşınmaz, en az 45 gerekli.`:"Kervan hazır.",
       order:"Çevre köylerden göçmen çağır."},
      {ok:mood.populationRate>0,label:"Halkı doyur",detail:"İstihkakı %100'e çek, vergiyi indir",
       why:mood.populationRate>0?"Halk memnun; nüfus kendiliğinden büyüyor.":"Rıza 40'ın altındayken nüfus artmaz, 25'in altında erir.",order:"Yiyecek istihkakını %100 yap."},
      {ok:room>0,label:"Kapasiteyi büyüt",detail:`Meydan +80 · Kale her seviye +50 · şu an ${room} kişilik boş yer`,
       why:room>0?"Yer var; büyüme bu tavana kadar sürer.":"Kapasite dolu; nüfus artık büyümez.",order:"Meydan kur."},
      {ok:game.buildings.some(b=>b.type==="marriage_hall"),label:"Evlilik Dairesi",detail:"Büyüme hızını %15 artırır",
       why:game.buildings.some(b=>b.type==="marriage_hall")?"Kurulu; büyüme hızlanıyor.":"Henüz kurulmadı (Kale Sv.2 gerekir).",order:"Evlilik Dairesi kur."},
     ];
     return <div className="pop-ledger">
      <div className="section-head"><span>NÜFUS DEFTERİ</span><b className={perDay<0?"loss":perDay>0?"gain":""}>{perDay>=0?"+":""}{Math.round(perDay)} kişi/gün</b></div>
      <div className="ledger-rows">
       <div><span>Kuruluştan beri yerleşen</span><b className="gain">+{joined}</b></div>
       <div><span>Kuruluştan beri göç eden</span><b className="loss">−{lost}</b></div>
       <div><span>Boş konut</span><b>{room} kişilik</b></div>
       <div><span>Madende çalışan</span><b>{Math.round(game.mineWorkers??0)} kişi</b></div>
       <div><span>Silah altında</span><b>{army} kişi</b></div>
      </div>
      <p className="ledger-note">{perDay<0
        ? `Halk ${mood.label.toLocaleLowerCase("tr-TR")} durumda ve krallığı terk ediyor. Göç, huzur düzelene kadar durmaz.`
        : perDay===0?"Nüfus sabit: ya rıza büyümeye yetmiyor ya da kapasite dolu."
        :`Bu hızla ${room>0?`kapasitenin dolmasına ${Math.max(1,Math.ceil(room/Math.max(1,perDay)))} gün var`:"kapasite zaten dolu"}.`}</p>
      <div className="pop-options">{options.map(option=><article key={option.label} className={option.ok?"pop-option ready":"pop-option"}>
        <div><b>{option.label}</b><span>{option.detail}</span><small>{option.why}</small></div>
        <button disabled={!option.ok||connecting} onClick={()=>void submitOrder(option.order)}>{option.ok?"EMRET":"HAZIR DEĞİL"}</button>
      </article>)}</div>
     </div>})()}

   <div className="ration-list">
    {([
      {key:"food",label:"Yiyecek istihkakı",value:r.food,cost:`${daily(demand.food)} yiyecek/gün`,hint:"%100 tam doyum. Altına inmek ucuzdur ama rıza çöker.",order:(v:number)=>`Yiyecek istihkakını %${v} yap.`,locked:false,policy:"foodRation" as PolicyKey},
      {key:"ale",label:"Bira istihkakı",value:r.ale,cost:`${daily(demand.ale)} bira/gün`,hint:brewery?"Moral verir ama açlığı telafi etmez.":"Önce Bira Evi kurulmalı.",order:(v:number)=>`Bira istihkakını %${v} yap.`,locked:!brewery,policy:"aleRation" as PolicyKey},
      {key:"pay",label:"Asker maaşı",value:r.soldierPay,cost:`${daily(demand.gold)} altın/gün`,hint:army?"Askerler huzursuzluğu bastırır; maaşsız kalırsa firar ederler.":"Henüz askeriniz yok.",order:(v:number)=>`Asker maaşını %${v} yap.`,locked:!army,policy:undefined},
    ]).map(row=><div className="ration-row" key={row.key}>
     <div className="ration-head"><b>{row.label}</b><strong>%{row.value}</strong></div>
     <div className="ration-bar"><i style={{width:`${Math.min(100,row.value/2)}%`}}/></div>
     <small>{row.cost} · {row.hint}</small>
     <div className="ration-actions">
      {row.policy
        ? <><button disabled={row.value<=0} onClick={()=>setPolicy(row.policy!,step(row.value,-25))}>−25</button>
            <button disabled={row.value>=200} onClick={()=>setPolicy(row.policy!,step(row.value,25))}>+25</button></>
        : <><button disabled={row.locked||connecting||row.value<=0} onClick={()=>void submitOrder(row.order(step(row.value,-25)))}>AZALT</button>
            <button disabled={row.locked||connecting||row.value>=200} onClick={()=>void submitOrder(row.order(step(row.value,25)))}>ARTIR</button></>}
     </div>
    </div>)}
   </div>

   <div className="ration-row">
    <div className="ration-head"><b>Vergi oranı</b><strong>%{game.taxRate}</strong></div>
    <div className="ration-bar"><i style={{width:`${game.taxRate*2}%`}}/></div>
    <small>{Math.round(rt?.gold??0)} altın/sa · %15 nötr kabul edilir; üstü rızayı aşındırır, %40 üstü isyan davetidir.</small>
    <div className="ration-actions">
     <button disabled={game.taxRate<=0} onClick={()=>setPolicy("taxRate",game.taxRate-5)}>−5</button>
     <button disabled={game.taxRate>=50} onClick={()=>setPolicy("taxRate",game.taxRate+5)}>+5</button>
    </div>
   </div>

   {army>0&&<div className={`soldier-mood${unrest>=60?" alarm":unrest>=30?" warn":""}`}>
    <span>ORDU HUZURSUZLUĞU</span><strong>{unrest}</strong>
    <small>{unrest>=85?"Ordu isyan etti; artık kimseyi zapt etmiyorlar.":unrest>=60?"Firar başladı.":unrest>=30?"Askerler maaşlarını istiyor.":"Ordu sakin."}</small>
   </div>}

   <div className="amenity-grid">
    {[["park","Park"],["brewery","Bira Evi"],["marriage_hall","Evlilik Dairesi"],["theater","Tiyatro"]].map(([type,label])=>{
     const level=amenity(type);
     return <button key={type} className={level?"built":""} disabled={connecting} onClick={()=>void submitOrder(`${label} yapısını Sv.${level+1} seviyesine ${level?"yükselt":"kur"}.`)}>
      <b>{label}</b><span>{level?`Sv.${level}`:"Kurulmadı"}</span><em>{level?"YÜKSELT":"EMİR VER"}</em>
     </button>;
    })}
   </div>
  </div>;})()}

 {tab==="ordu"&&<div className="army-panel"><div className="section-head"><span>GARNİZON · RAPOR</span><b>{armySize(game.units)} birlik</b></div>{(()=>{const defense=defenseOf(game),watch=watchRatioOf(game),upkeep=armyUpkeep(game.units),experience=Math.round(armyExperience(game.units,game.unitExperience)),readiness=watch>=70?"Güçlü":watch>=40?"Dengeli":watch>0?"Kırılgan":"Hazır değil";return <><header className="page-heading army-page-heading"><div><span>ASKERÎ KUVVET</span><h3>Ordu</h3></div><p>Birliklerin eğitimi, nüfus yükü ve bakımı aynı katalogdan hesaplanır. Sefer Masası, keşfedilmiş hedef için birlik, ikmal ve geri çekilme emrini burada kurulan garnizondan alır.</p></header><div className="war-overview"><article className="readiness-card"><div><span>GENEL HAZIRLIK</span><h3>{readiness}</h3><strong>%{watch}</strong></div><i><u style={{width:`${watch}%`}}/></i><p><b>Garnizon</b><span>{defense.army} birlik</span><em>{armyManpower(game.units)} kişi silah altında</em></p><p><b>Nöbet</b><span>%{watch}</span><em>{defense.watchers} birlik hatta</em></p><p><b>Saha deneyimi</b><span>{experience}/100</span><em>Akın püskürtülünce artar</em></p><p><b>Savunma gücü</b><span>{Math.round(defense.power)}</span><em>{defense.wall?`Sur Sv.${defense.wall}`:"Sur yok"}</em></p><p><b>Saatlik bakım</b><span>{upkeep.gold.toFixed(2)} altın</span><em>{upkeep.food.toFixed(2)} yiyecek</em></p></article><article className="campaign-card"><h3>Garnizon planı</h3><div><i>1</i><p><b>Birlik bileşimini kur</b><span>Her tür farklı insan gücü, bakım ve savunma getirir.</span></p></div><div><i>2</i><p><b>Nöbeti dengele</b><span>Yüksek nöbet akını karşılar; iç düzen için kalan askeri azaltır.</span></p></div><div><i>3</i><p><b>General değerlendirmesi</b><span>Eğitimden önce nüfus, yiyecek ve garnizon riskini tartar.</span></p></div><button onClick={()=>setTab("sefer")}>SEFER MASASINI AÇ</button><button onClick={()=>{setMessage("Garnizon bileşimimizi değerlendir ve hangi birliği eğitmem gerektiğini öner.");setTab("general")}}>GENERALDEN PLAN İSTE</button></article></div></>})()}<div className="general-only-note"><b>Orduyu General yönetir</b><span>Birlik türünü ve adedini söyle. General, Kışla seviyesi, nüfusu, ikmali ve saha deneyimini kontrol ederek eğitimi başlatır.</span></div>{game.trainingQueue&&<div className="training-status"><b>EĞİTİM SÜRÜYOR</b><span>{game.trainingQueue.name}</span><em>{left(game.trainingQueue.completesAt,now)} kaldı</em></div>}<div className="unit-roster">{unitCatalog.map(unit=>{const trainable=isTrainableUnit(unit),locked=!trainable||(game.buildings.find(building=>building.type==="barracks")?.level??0)<unit.barracksLevel;const cost=unitCostFor(unit.type,1),experience=Math.round(experienceOf(game.unitExperience,unit.type));return <article className={locked?"unit-card locked":"unit-card"} key={unit.type}><span>{trainable?`Kışla Sv.${unit.barracksLevel}`:"MÜZAKERE SÖZLEŞMESİ"}</span><h4>{unit.name}</h4><p>{unit.role}</p><div><b>{game.units[unit.type]??0}</b><small>birlik</small></div><dl><dt>Saldırı / Savunma</dt><dd>{unit.attack} / {unit.defense}</dd><dt>Hız / İnsan gücü</dt><dd>{unit.speed} / {unit.manpower}</dd><dt>Saha deneyimi</dt><dd>{experience}/100</dd><dt>{trainable?"Maliyet":"Sözleşme"}</dt><dd>{trainable?Object.entries(cost).map(([key,value])=>`${value} ${key}`).join(" · "):"Peşin bedel ve süre elçilikte konuşulur"}</dd></dl><button disabled={locked||Boolean(game.trainingQueue)} onClick={()=>{setMessage(`${unit.name} eğitmek istiyorum. Mevcut duruma göre uygun bir adet belirle ve başlat.`);setTab("general")}}>{!trainable?"SÖZLEŞMEYLE GELİR":locked?`Kışla Sv.${unit.barracksLevel} GEREKLİ`:game.trainingQueue?"EĞİTİM SÜRÜYOR":"GENERALE İLET"}</button></article>})}</div>
  {(()=>{const d=defenseOf(game),watch=watchRatioOf(game),raids=game.notices.filter(n=>n.kind==="AKIN").slice(0,3);
   const step=(delta:number)=>Math.max(0,Math.min(100,watch+delta));
   // GARNİZON DURUMU. Eşikler tek dosyadadır (engine/populace-voice.ts); panel,
   // motor ve Generalin promptu aynı listeyi okur, kopya yoktur.
   const unrestNow=game.soldierUnrest??0,garrison=garrisonMood(unrestNow,d.army),vetoes=garrisonVetoes(unrestNow,d.army);
   const vetoLabel:Record<string,string>={train_unit:"Yeni asker eğitimi",raise_watch:"Nöbeti YÜKSELTME",set_soldier_pay:"Asker maaşını değiştirme"};
   return <><div className={`garrison-block ${garrison.id}`}>
    <div className="section-head"><span>GARNİZON DURUMU</span><b>{garrison.label}</b></div>
    <div className="garrison-gauge"><i style={{width:`${Math.min(100,Math.round(unrestNow))}%`}}/></div>
    <small>Huzursuzluk {Math.round(unrestNow)} · {garrison.note}</small>
    {d.army>0&&<div className="garrison-vetoes">
     {(["train_unit","raise_watch","set_soldier_pay"] as const).map(order=>
      <div key={order} className={vetoes.includes(order)?"refused":"allowed"}>
       <b>{vetoLabel[order]}</b><span>{vetoes.includes(order)?"REDDEDİLİR":"UYGULANABİLİR"}</span>
      </div>)}
    </div>}
    {vetoes.includes("set_soldier_pay")
      ? <p className="garrison-warning">Ordu isyan hâlinde: maaş defterine de el sürmüyorlar. Bu kilidin dışarıdan bir çıkışı yok — huzursuzluk kendiliğinden düşene kadar kışla emir almaz.</p>
      : <p className="garrison-warning quiet">Askerin vetosu Kralın teyidiyle aşılmaz; kışla ancak maaşı düzelirse ikna olur. Nöbeti İNDİRME emri her koşulda kabul edilir.</p>}
   </div>
   <div className="watch-block">
    <div className="watch-head"><b>Nöbet oranı</b><strong>%{watch}</strong></div>
    <div className="ration-bar"><i style={{width:`${watch}%`}}/></div>
    <small>{d.watchers} asker nöbette · savunma gücü {Math.round(d.power)}{d.wall?` · Sur Sv.${d.wall}`:" · Sur yok"}</small>
    <small className="watch-tradeoff">Nöbetteki asker akını karşılar ama halkı zapt etmeye daha az katkı verir. Yükseltirsen yağma azalır, huzursuzluk artar.</small>
    <div className="ration-actions">
     <button disabled={connecting||watch<=0||!d.army} onClick={()=>void submitOrder(`Nöbet oranını %${step(-20)} yap.`)}>AZALT</button>
     <button disabled={connecting||watch>=100||!d.army} onClick={()=>void submitOrder(`Nöbet oranını %${step(20)} yap.`)}>ARTIR</button>
    </div>
   </div>
   <div className="raid-log">
    <div className="raid-tally"><span>Püskürtülen</span><b>{game.raidsRepelled??0}</b><span>Yarılan</span><b className={(game.raidsSuffered??0)>0?"bad":""}>{game.raidsSuffered??0}</b></div>
    {/* Haydut yönlendirmenin okunduğu yer artık İSTİHBARAT sekmesi: "eşkıya
        kimin eliyle bu tarafa çekiliyor" bir garnizon raporu değil, komşuya
        dair bir istihbarat bulgusudur. Buraya kopyası BIRAKILMADI. */}
    {raids.length?raids.map((n,i)=><p key={i}>{n.text}</p>):<p className="quiet">Dağlardan henüz akın gelmedi.</p>}
   </div></>;})()}
  </div>}
 {tab==="sefer"&&<div className="campaign-panel"><WarCampaignWorkspace game={game} targets={otherKingdoms} initialTargetId={campaignTarget} initialDraft={campaignDraft} onOpenNegotiation={id=>{setSelectedNegotiationId(id);setTab("muzakere");setPanelOpen(true)}}/></div>}
 {/* İSTİHBARAT — komşuya YÖNELİK araçların tek yeri (plan belgesi, Fikir 3
     ve altındaki "Karar (2026-08-22)"). Karşı-istihbarat, dış kese ve haydut
     yönlendirme buraya "diyar" ve "ordu" sekmelerinden TAŞINDI; eski
     yerlerinde kopyaları bırakılmadı.

     MUHALEFET PANELİ BİLİNÇLİ OLARAK "halk" SEKMESİNDE KALDI: muhalefet KENDİ
     halkımızın rızasıyla ilgilidir ve tek çıkışı istihkak/vergi/konut
     kararlarıdır — onu bu sekmeye almak, halkı komşu gibi "hedef" sayan
     yanlış bir okuma üretirdi. Bu sekme dışa, "halk" sekmesi içe bakar. */}
 {tab==="istihbarat"&&(()=>{
  // Skor motorda hesaplanır: katsayılar, satır etiketleri ve doktrin okunuşu
  // engine/victory.ts'te TEK kaynakta. Girdi olarak CANLI oyun durumu ile
  // sunucunun gönderdiği kese defteri verilir.
  const score=victoryScore({purses:victory?.purses??[],caughtPurses:victory?.caught??0,game});
  const lure=lureAt(game,now);
  return <div className="realm">
   <div className="section-head"><span>DOLAYLI MÜCADELE · İSTİHBARAT</span><b>{score.total} PUAN</b></div>
   <header className="page-heading"><div><span>SİYASİ VE İSTİHBARİ GÜÇ</span><h3>Dolaylı Mücadele</h3></div><p>Gelen faaliyetler kapatılamaz; karşı istihbarat etkiyi azaltır, kaynağı açığa çıkarır ve misilleme fırsatı doğurur.</p></header><nav className="indirect-tabs"><button className={indirectView==="overview"?"active":""} onClick={()=>{setIndirectView("overview");setSelectedOperation(null)}}>Genel Bakış</button><button className={indirectView==="political"?"active":""} onClick={()=>{setIndirectView("political");setSelectedOperation(null)}}>Siyasi</button><button className={indirectView==="intelligence"?"active":""} onClick={()=>{setIndirectView("intelligence");setSelectedOperation(null)}}>İstihbarat</button></nav>
   {indirectView==="overview"&&<div className="world-intel">
    <div className="victory-score">
     <div className="section-head"><span>ZAFER SKORU · SEZON ÖLÇÜTÜ</span><b>{score.doctrine.label}</b></div>
     <div className="victory-columns">
      <div className="quiet"><span>DOLAYLI ÜSTÜNLÜK</span><b>{score.quiet}</b></div>
      <div className="martial"><span>ASKERİ KATKI</span><b>{score.martial}</b></div>
      <div className="total"><span>TOPLAM</span><b>{score.total}</b></div>
     </div>
     <p className="victory-doctrine">{score.doctrine.note}</p>
     <div className="victory-lines">{score.lines.map(line=><article key={line.id} className={line.column}>
       <div><b>{line.label}</b><small>{line.detail}</small></div>
       <strong className={line.points>0?"gain":line.points<0?"loss":""}>{line.points>0?"+":""}{line.points}</strong>
      </article>)}</div>
     {/* Sıra sunucudan gelir ve gizlilik alt sınırına tabidir; komşunun skoru,
         adı ve kalemleri hiçbir koşulda inmez. */}
     <small className="victory-rank">{victory?.rank
       ? `Channel sıralaması: ${victory.rank} / ${victory.ranked} sancak. Komşuların skoru ve kimliği size inmez.`
       : `Sıralama verilmedi: sıra en az ${COMPARE_MIN_SAMPLE+1} sancakla açıklanır; kuruluş koruması süren sancaklar (ve koruması süren Kral) sayılmaz.`}</small>
     <small className="victory-note">Skor bir GÖSTERGEDİR: sezonu bitirmez, kimseyi kazanan ilan etmez. Sezon channel süresine bağlı kapanır.</small>
    </div>
    <div className="intel-defense"><div><b>KARŞI-İSTİHBARAT</b><span>{worldDefense.active?`Nöbet etkin · ${left(worldDefense.activeUntil??now,now)}`:"Ajan savunması kapalı"}</span>{incomingAlerts>0&&<em>{incomingAlerts} düşman ajanı tespit edildi</em>}</div><button disabled={worldBusy||worldDefense.active} onClick={()=>void worldAction("defend")}>{worldDefense.active?"NÖBETTE":"NÖBET KUR"}</button></div>
    {/* Gelen dolaylı faaliyetler kapatılamaz. Karşı-istihbarat yalnızca etkiyi
        azaltır, göndereni açığa çıkarabilir ve misilleme fırsatı üretir. */}
    <div className="intel-defense incoming-line"><GameIcon name="istihbarat"/><div><b>GELEN DOLAYLI FAALİYETLER</b><span>Propaganda, diplomatik baskı ve halk hareketlerine destek her zaman mümkündür.</span><em>Savunma: etkiyi azalt · göndereni açığa çıkar · misilleme fırsatı oluştur</em><small>Bugün gönderdiğiniz: {agitation.sentToday}/{agitation.perDay} · operasyon bedeli {agitation.cost} altın</small></div></div>
    {/* Yönlendirme: hedef ne olduğunu hisseder ama kimin çektiğini bilemez —
        bilgi sınırı burada da geçerli. Şiddet değişmez, sıklık artar. */}
    <div className="intel-defense"><div><b>HAYDUT YÖNLENDİRME</b><span>{lure>0
      ?"Dağ yollarında tuhaf bir hareket var: akınlar olması gerekenden sık geliyor ve eşkıya hep bu tarafa çekiliyor. Akınların şiddeti değişmedi; sıklığı arttı. Kimin çektiği belli değil."
      :"Dağ yolları olağan; eşkıyayı bu tarafa çeken bir el görünmüyor."}</span><em>{lure>0
      ?"Sıklık arttığı için nöbet oranını Ordu sekmesinden gözden geçirin; yönlendirme kendiliğinden söner."
      :"Komşuya eşkıya çekmek Generalin işidir: Meclis'te hangi sancak olduğunu söyleyin."}</em></div></div>
   </div>}
   {indirectView!=="overview"&&!selectedOperation&&<div className="operation-grid">{indirectView==="political"?<><button onClick={()=>setSelectedOperation("gold_commons")}><span>SİYASİ</span><b>Propaganda</b><p>Hedef halktaki mevcut memnuniyetsizliği besler; yoktan isyan yaratmaz.</p><em>YÖNTEM SEÇ →</em></button><button onClick={()=>{setEnvoyTopic("ultimatum");setTab("muzakere")}}><span>SİYASİ</span><b>Diplomatik baskı</b><p>Ültimatom ve bağlayıcı şartlar üzerinden hedefin seçeneklerini daraltır.</p><em>MÜZAKEREYE GEÇ →</em></button><button onClick={()=>setSelectedOperation("support_movement")}><span>SİYASİ · HEDEFLİ</span><b>Halk hareketlerini destekleme</b><p>Yalnız kıpırdanan muhalefete kaynak bırakır; yoktan isyan yaratmaz.</p><em>HAREKETİ DESTEKLE →</em></button><button onClick={()=>setSelectedOperation("gold_garrison")}><span>SİYASİ</span><b>Garnizon nüfuzu</b><p>Hedef askerler arasındaki mevcut huzursuzluğu altınla besler.</p><em>YÖNTEM SEÇ →</em></button></>:<><button onClick={()=>setSelectedOperation("scout")}><span>İSTİHBARAT</span><b>Bilgi toplama</b><p>Hedefin kalesi, nüfusu, ordusu ve rapordan çıkarılan zayıflıkları açar.</p><em>HEDEF SEÇ →</em></button><button onClick={()=>setSelectedOperation("deep_scout")}><span>İSTİHBARAT · RİSKLİ</span><b>Derin gözetleme</b><p>100 altın karşılığında halkın kaba ruh hâlini dinler; daha yavaş ve daha görünürdür.</p><em>HALKIN NABZINI DİNLE →</em></button><button onClick={()=>setSelectedOperation("spy_network")}><span>İSTİHBARAT · KALICI</span><b>Casus ağı kurma</b><p>Önceden keşfedilmiş hedefe sızar; düzenli rapor getirir, nöbet hattı açığa çıkarabilir.</p><em>AĞ KUR →</em></button><button onClick={()=>setSelectedOperation("goods_glut")}><span>İSTİHBARAT</span><b>Pazar sabotajı</b><p>Hedef pazara mal yığar; satış fiyatını düşürür, alış ve rızayı doğrudan değiştirmez.</p><em>YÖNTEM SEÇ →</em></button><button onClick={()=>setSelectedOperation("raid_lure")}><span>İSTİHBARAT</span><b>Haydut yönlendirme</b><p>Akın şiddetini değil, hedefe gelen akın sıklığını geçici olarak artırır.</p><em>YÖNTEM SEÇ →</em></button><button onClick={()=>setSelectedOperation("defend")}><span>İSTİHBARAT</span><b>Karşı istihbarat</b><p>Etkiyi azaltır, göndereni açığa çıkarabilir ve misilleme fırsatı oluşturur.</p><em>SAVUNMA PLANI →</em></button></>}</div>}
   {selectedOperation&&<div className="operation-builder"><header><button onClick={()=>setSelectedOperation(null)}>← OPERASYONLARA DÖN</button><h3>{selectedOperation==="scout"?"Bilgi toplama":selectedOperation==="deep_scout"?"Derin gözetleme":selectedOperation==="defend"?"Karşı istihbarat":selectedOperation==="goods_glut"?"Pazar sabotajı":selectedOperation==="raid_lure"?"Haydut yönlendirme":selectedOperation==="gold_garrison"?"Garnizon nüfuzu":selectedOperation==="support_movement"?"Halk hareketini destekleme":"Propaganda"} planı</h3></header><div className="builder-steps"><b>1 · Operasyon</b><b>2 · Hedef</b><b>3 · Yöntem ve kaynak</b><b>4 · General</b></div><div className="builder-layout"><section className="target-list"><span>HEDEFİ DİYAR HARİTASINDAN SEÇ</span>{selectedOperation==="defend"?<article className="self-target"><b>{game.kingdomName}</b><small>Kendi krallığınız · savunma</small></article>:otherKingdoms.map(kingdom=><button key={kingdom.id} className={operationTarget===kingdom.id?"selected":""} onClick={()=>setOperationTarget(kingdom.id)}><b>{kingdom.name??"Bilinmeyen Sancak"}</b><small>İstihbarat: {kingdom.report?kingdom.reportStale?"Düşük":"Dengeli":"Yok"}</small></button>)}</section><aside className="operation-plan"><h4>{selectedOperation==="defend"?game.kingdomName:otherKingdoms.find(item=>item.id===operationTarget)?.name??"Haritadan hedef seç"}</h4><div className="target-intel"><b>Bilinen zayıflıklar</b><span>{selectedOperation==="defend"?"Gelen faaliyetlere karşı bir saatlik nöbet kurulur.":selectedOperation==="support_movement"?"Yalnız muhalefet kıpırdanmış bir hedefte işe yarar; Kralın karşı istihbaratı desteği açığa çıkarabilir.":selectedOperation==="deep_scout"?"Normal rapora yalnız halkın kaba ruh hâli eklenir; rıza puanı, ambar ve maaş gizli kalır.":otherKingdoms.find(item=>item.id===operationTarget)?.report?"Kale, nüfus ve ordu raporu mevcut; ayrıntı Diyar panelinde.":"Doğrulanmış rapor yok; önce bilgi toplama önerilir."}</span></div>{selectedOperation==="goods_glut"&&<label>YIĞILACAK KAYNAK<select value={operationResource} onChange={event=>setOperationResource(event.target.value as TradeKey)}>{[["food","Yiyecek"],["wood","Odun"],["stone","Taş"],["iron","Demir"],["ale","Bira"]].map(([id,label])=><option value={id} key={id}>{label}</option>)}</select></label>}<span>YAKLAŞIM</span><div className="intensity-list"><button disabled><b>Düşük</b><small>Motor desteği yok</small></button><button className="selected"><b>Dengeli</b><small>Gerçek oyun yaklaşımı</small></button><button disabled><b>Yoğun</b><small>Motor desteği yok</small></button></div><dl><div><dt>Beklenen sonuç</dt><dd>{selectedOperation==="scout"?"Açık istihbarat raporu":selectedOperation==="deep_scout"?"Rapor + halkın ruh hâli":selectedOperation==="defend"?"Etki azaltma":selectedOperation==="goods_glut"?"Satış fiyatı düşer":selectedOperation==="raid_lure"?"Akın sıklığı artar":selectedOperation==="gold_garrison"?"Garnizon huzursuzluğu":selectedOperation==="support_movement"?"Muhalefet baskısı güçlenir":"Halk huzursuzluğu"}</dd></div><div><dt>Açığa çıkma</dt><dd>{selectedOperation==="defend"?"Yok":selectedOperation==="deep_scout"?"Yüksek":"Olası"}</dd></div><div><dt>Maliyet</dt><dd>{selectedOperation==="scout"||selectedOperation==="defend"?"İstihbarat süresi":selectedOperation==="deep_scout"?"100 altın · iki kat süre":selectedOperation==="support_movement"?`${MOVEMENT_SUPPORT.cost} altın`:`${agitation.cost} altın`}</dd></div></dl><div className="plan-actions"><button onClick={()=>{setMessage("Bu dolaylı operasyonun risklerini ve olası karşılığını değerlendir.");setTab("general")}}>GENERALLE İSTİŞARE ET</button><button disabled={worldBusy||(selectedOperation!=="defend"&&!operationTarget)} onClick={()=>{if(selectedOperation==="scout")void worldAction("scout",operationTarget);else if(selectedOperation==="deep_scout")void worldAction("deep_observation",operationTarget);else if(selectedOperation==="defend")void worldAction("defend");else void agitationAction(operationTarget,selectedOperation,operationResource)}}>GENERALE İLET</button></div></aside></div></div>}
  </div>;})()}
 {tab==="defter"&&(()=>{const category=(kind:string):"decision"|"economy"|"war"|"diplomacy"|"people"=>/AKIN|ORDU|NÖBET/i.test(kind)?"war":/PAZAR|İNŞAAT|ÜRETİM|KAYNAK/i.test(kind)?"economy":/ELÇİ|ANLAŞMA|MÜZAKERE/i.test(kind)?"diplomacy":/HALK|GÖÇ|İSTİHKAK|MUHALEFET/i.test(kind)?"people":"decision";const labels={all:"TÜMÜ",decision:"KARARLAR",economy:"EKONOMİ",war:"SAVAŞ",diplomacy:"DİPLOMASİ",people:"HALK"} as const;const entries=[...game.notices].reverse().filter(notice=>ledgerFilter==="all"||category(notice.kind)===ledgerFilter);return <div className="chronicle"><header className="page-heading"><div><span>KRALLIK HAFIZASI</span><h3>Defter</h3></div><p>Kronolojik akış; karar, savaş, ekonomi, diplomasi ve halk filtreleriyle incelenir.</p></header><section className="council-ledger"><div className="section-head"><span>DİVAN KAYITLARI</span><b>SON ÜÇ TOPLANTI</b></div>{councilMeetings.length?<CouncilMeetingList meetings={councilMeetings} compact/>:<p className="council-history-empty">Henüz arşivlenmiş bir Divan toplantısı yok.</p>}</section><nav className="ledger-filters">{Object.entries(labels).map(([id,label])=><button key={id} className={ledgerFilter===id?"active":""} onClick={()=>setLedgerFilter(id as typeof ledgerFilter)}>{label}</button>)}</nav><div className="ledger-timeline">{entries.length?entries.map((notice,index)=>{const type=category(notice.kind);return <article key={`${notice.at}-${index}`}><time>{new Date(notice.at).toLocaleDateString("tr-TR",{day:"2-digit",month:"short"})} · {new Date(notice.at).toLocaleTimeString("tr-TR",{hour:"2-digit",minute:"2-digit"})}</time><i>{type==="war"?"⚔":type==="economy"?"⚖":type==="diplomacy"?"✦":type==="people"?"♧":"♜"}</i><div><b>{notice.kind}</b><span>{notice.text}</span></div><em>{labels[type]} →</em></article>}):<div className="ledger-empty">Bu filtrede henüz kayıt yok.</div>}</div></div>;})()}
 {tab==="diyar"&&<ChannelWorldMap embedded channelName={game.channel} homeName={game.kingdomName} homeTerrain={game.terrain} homePosition={worldHome} extent={worldExtentValue} homeKeepLevel={lv} kingdoms={otherKingdoms} sharedMine={sharedMine} worldEvent={worldEvent} busy={worldBusy} formatLeft={at=>left(at,now)} relationFor={kingdom=>diplomaticStatusFor(kingdom as WorldKingdom)} onClose={()=>setPanelOpen(false)} onScout={id=>void worldAction("scout",id)} onDeepObserve={id=>void worldAction("deep_observation",id)} onMine={action=>void mineAction(action)} onNegotiate={id=>{setEnvoyTarget(id);setTab("muzakere")}} onCampaign={id=>{setCampaignTarget(id);setTab("sefer")}}/>}
 {tab==="iliskiler"&&<div className="relations-workspace"><header className="page-heading"><div><span>DİPLOMATİK DURUM</span><h3>Krallık ilişkileri</h3></div><p>İlişki puanı, savaş desteği gibi kalıcı diplomatik tercihlerin hafızasıdır; karşı tarafın sözleri ise yine iddiadır.</p></header><div className="relations-grid">{otherKingdoms.length?otherKingdoms.map(kingdom=>{const agreement=agreementList.find(deal=>deal.counterpartId===kingdom.id),table=negotiationTables.find(item=>item.counterpartId===kingdom.id&&item.status!=="agreed"&&item.status!=="declined");return <article key={kingdom.id}><span>{agreement?"ANLAŞMALI":table?"MÜZAKEREDE":diplomaticStatusFor(kingdom).toUpperCase()}</span><h3>{kingdom.name??"Bilinmeyen Sancak"}</h3><p>{agreement?`${agreement.endsAt>now?left(agreement.endsAt,now):"Süresi doldu"} süreli anlaşma yürürlükte.`:table?`${table.turns}/${envoyLimits.maxTurns} söz · ${table.canAccept?"Kral onayı bekleniyor":"yazışma sürüyor"}.`:kingdom.discovered?`İlişki durumu: ${diplomaticStatusFor(kingdom)}.`:"Krallık adı ve yönetim bilgisi keşfedilmedi."}</p><button onClick={()=>{if(table)setSelectedNegotiationId(table.id);setEnvoyTarget(kingdom.id);setTab(table?"muzakere":"diyar")}}>{table?"MASAYI AÇ":kingdom.discovered?"HARİTADA GÖR":"AJAN GÖNDER"}</button></article>}):<div className="ledger-empty">Bu channel&apos;da ilişki kurulacak başka sancak yok.</div>}</div></div>}
 {tab==="muzakere"&&(()=>{const table=negotiationTables.find(item=>item.id===(selectedNegotiationId??negotiationTables[0]?.id));if(!table)return <div className="negotiation-empty"><header className="page-heading"><div><span>ELÇİLİK MASASI</span><h3>Müzakere</h3></div><p>Bağlayıcı anlaşmaları ve elçi yazışmalarını aynı alanda yönetin.</p></header><h3>Açık müzakere masası yok</h3><p>Diyar haritasından keşfedilmiş bir krallık seçerek yeni masa açabilirsiniz.</p><button onClick={()=>setTab("diyar")}>DİYAR HARİTASINA DÖN</button></div>;const terms=table.proposed,isMercenary=table.topic==="mercenary";return <div className="realm-negotiation"><header className="page-heading"><div><span>ELÇİLİK MASASI · {table.turns}/{envoyLimits.maxTurns} SÖZ</span><h3>{table.counterpart} ile müzakere</h3></div><p>Ortada bağlayıcı anlaşma belgesi; yanında elçi yazışmaları ve karşı teklif alanı.</p></header><div className="realm-negotiation-grid"><article className="treaty-document"><div className="document-seal">✦</div><span>ANLAŞMA TASLAĞI</span><h3>{table.topic==="non_aggression"?"Saldırmazlık":table.topic==="alliance"?"İttifak":table.topic==="passage"?"Geçiş izni":table.topic==="tribute"?"Haraç":isMercenary?"Kiralık Birlik":"Ültimatom"}</h3><div className="treaty-parties"><b>{game.kingdomName}</b><i>↔</i><b>{table.counterpart}</b></div><div className="treaty-clause"><i>1</i><div><b>Ana şart</b><span>{terms?"Tarafların sunduğu şart imza için hazırdır.":"Henüz bağlayıcı şart sunulmadı."}</span></div><em>{terms?.hours??24} SAAT</em></div><div className="treaty-clause"><i>2</i><div><b>{isMercenary?"Kiralık birlik":"Haraç"}</b><span>{isMercenary?terms?.mercenaryCount?`${terms.mercenaryCount} birlik · ${terms.mercenaryFee??0} altın peşin; kayıplar kiralayanın nüfusuna yazılır.`:"Henüz birlik ve bedel belirtilmedi.":terms?.tributeAmount?`${terms.tributeAmount} ${resourceLabels.find(([id])=>id===terms.resource)?.[1]??terms.resource}`:terms?.tributeRate?`Ambarın %${Math.round(terms.tributeRate*100)}'i`:"Bu taslak haraç şartı taşımıyor."}</span></div><em>{isMercenary&&terms?.mercenaryCount?"DAHİL":terms?.tributeAmount||terms?.tributeRate?"DAHİL":"YOK"}</em></div><p>Şartı Generaller sunabilir; bağlayıcı imzayı yalnızca Kral atar.</p>{table.canAccept&&<div className="treaty-actions"><button disabled={worldBusy} onClick={()=>void negotiationAction(table.id,"decline")}>REDDET</button><button disabled={worldBusy} onClick={()=>void negotiationAction(table.id,"accept")}>ANLAŞMAYI İMZALA</button></div>}</article><aside className="envoy-correspondence"><h3>Elçi yazışmaları</h3>{table.messages.map((line,index)=><p className={line.mine?"ours":""} key={index}><b>{line.speaker}</b>{line.body}</p>)}<div className="counteroffer-summary"><span>KARŞI TEKLİF</span><p>Yeni şartın türünü, süresini ve varsa haraç yönünü ayrıntılı masada belirleyin.</p><button onClick={()=>{setSelectedNegotiationId(table.id);setNegotiationOpen(true)}}>KARŞI TEKLİFİ HAZIRLA</button></div></aside></div></div>;})()}
 {/* Eski Diyar özeti yalnızca geriye dönük kaynak referansı; yeni gömülü harita kullanılır. */}
 {/* eslint-disable-next-line no-constant-binary-expression */}
 {Boolean(0)&&tab==="diyar"&&<div className="realm"><div className="section-head"><span>DIŞ ÇEPER · KORUMALI</span><b>{left(game.protectionEndsAt,now)}</b></div><div className={`terrain-summary ${game.terrain}`}><span>BAŞKENT ARAZİSİ</span><b>{(terrainCatalog[game.terrain]??terrainCatalog.plain).label}</b><p>{(terrainCatalog[game.terrain]??terrainCatalog.plain).description}</p><small>{(terrainCatalog[game.terrain]??terrainCatalog.plain).bonus}</small></div>{worldError&&<div className="world-error"><b>Channel bilgisi alınamadı</b><span>{worldError}</span><small>Bu yüzden komşu sancaklar ve ortak saha görünmüyor; haritadaki konumunuz da geçici olarak merkeze düşer.</small></div>}<div className="world-intel">
 {/* CHANNEL KIYASI — anonim. Sunucu yalnızca ortalamayı gönderir (kimin hangi
     değere sahip olduğu inmez) ve aday sayısı gizlilik alt sınırının altındaysa
     sayı hiç üretilmez; o zaman burada da sayı yerine gerekçe görünür. */}
 {/* Kıyas hiç GELMEDİYSE (yerel oyun, channel bilgisi alınamadı) panel hiç
     çizilmez: "yeterli sancak yok" demek yanlış bir iddia olurdu. */}
 {sharedMine?.influence&&<div className="mine-influence-summary"><b>MADEN NÜFUZU</b><span>{sharedMine.influence.ownerName?`${sharedMine.influence.ownerName} etkin üretimde rakiplerden %10 pay alıyor.`:"İlk nüfuz sahibi belirleniyor; en çok emek biriktiren krallık avantaj kazanacak."}</span><small>{Math.floor(sharedMine.influence.gameHours)}/{sharedMine.influence.windowHours} oyun saati · anlık işçi sayısı değil, üretim penceresindeki emek sayılır.</small></div>}
 {channelCompare&&<div className="channel-compare"><div className="compare-head"><span>CHANNEL KIYASI · ANONİM</span><b>{channelCompare.averages?`${channelCompare.counted} SANCAK`:"YETERSİZ"}</b></div>{(()=>{const averages=channelCompare.averages;
   if(!averages)return <small className="compare-note">Kıyas için yeterli sancak yok: ortalama en az {COMPARE_MIN_SAMPLE} sancaktan hesaplanır. Daha azında &quot;ortalama&quot; tek bir komşunun defterini olduğu gibi ele verirdi.{channelCompare.protectedOut>0?` Kuruluş koruması süren ${channelCompare.protectedOut} sancak da sayılmadı.`:""}</small>;
   // Bizdeki değerler ortalamayla AYNI motor fonksiyonundan okunur; kıyas ise
   // gösterilen (yuvarlanmış) sayılar üzerinden yapılır, yoksa ekranda eşit
   // görünen iki sayının biri yeşil biri kırmızı olurdu.
   const mine=compareValuesOf(game);
   return <><div className="compare-grid"><i>ÖLÇÜT</i><i>BİZDE</i><i>ORTALAMA</i>{COMPARE_METRICS.map(metric=>{const ours=Math.round(mine[metric]),theirs=Math.round(averages[metric]);
     return <Fragment key={metric}><span>{compareLabels[metric].name}</span><b className={compareVerdict(metric,ours,theirs)}>{compareText(metric,ours)}</b><em>{compareText(metric,theirs)}</em></Fragment>})}</div>
     <small className="compare-note">Ortalamaya {channelCompare.counted} sancak girdi{channelCompare.protectedOut>0?`; kuruluş koruması süren ${channelCompare.protectedOut} sancak sayılmadı`:""}. Kendi krallığınız ortalamaya girmez ve hiçbir sancağın kendi değeri gösterilmez.</small></>})()}</div>}
 {sharedMine&&<div className="shared-mine"><span>⛏ CHANNEL ORTAK SAHASI</span><b>{sharedMine.mine.name}</b><small>{fmt(sharedMine.mine.extractedOre)} cevher çıkarıldı · {fmt(sharedMine.mine.oreRemaining)} kaldı · {sharedMine.mine.totalWorkers}/{sharedMine.channelSlots??60} yuva dolu</small><small className="mine-limit">Madenciler halkın içinden çıkar: nüfusunuzun en fazla %20&apos;si ({sharedMine.personalCap??0} kişi). Madendeki her el tarlada eksiktir.</small>{(()=>{const self=sharedMine.participants.find(worker=>worker.self),rate=sharedMine.orePerWorkerHour??0;
     return <small className="mine-limit">İşçi başına saatte {rate} cevher · {self?`${self.workers} işçiniz saatte ${self.workers*rate} demir getiriyor`:"şu an madende işçiniz yok"} · size teslim edilen toplam {fmt(self?.deliveredOre??0)} cevher. Cevher ambara sunucu tarafından yazılır, birikip toplu iner.</small>})()}<div>{sharedMine.participants.map(worker=><i key={worker.id}>{worker.name} · {worker.workers}{worker.deliveredOre?` · ${fmt(worker.deliveredOre)} cevher`:""}</i>)}</div><button disabled={worldBusy} onClick={()=>void mineAction(sharedMine.participants.some(worker=>worker.self)?"leave":"join")}>{sharedMine.participants.some(worker=>worker.self)?"İŞÇİLERİ ÇEK":`${Math.max(1,Math.min(sharedMine.personalCap??3,Math.round(game.population*.1)))} İŞÇİ GÖNDER`}</button></div>}<div className="world-kingdoms"><div className="section-head"><span>AYNI CHANNEL · {otherKingdoms.length} SANCAK</span><b>İsimler keşifle açılır</b></div>{otherKingdoms.length===0?<p className="empty-world">Bu channel&apos;da henüz başka bir krallık yok.</p>:otherKingdoms.map(kingdom=><article className={kingdom.discovered?"kingdom-contact discovered":"kingdom-contact"} key={kingdom.id}><div><b>{kingdom.name??"Bilinmeyen Sancak"}</b><span>{terrainCatalog[kingdom.terrain as TerrainId]?.label??"BİLİNMEYEN BÖLGE"} · Haritada ({kingdom.position.x}, {kingdom.position.z})</span></div>{kingdom.report?<small>Kale Sv.{kingdom.report.keepLevel} · {kingdom.report.population} nüfus · {kingdom.report.army} asker · {kingdom.report.buildingCount} yapı</small>:kingdom.mission?.status==="pending"?<small>Ajan yolda · {left(kingdom.mission.completesAt,now)} · başarı %{kingdom.mission.successChance}</small>:<small>İçerik gizli · keşif başarı ihtimali düşük</small>}<button disabled={worldBusy||kingdom.mission?.status==="pending"} onClick={()=>void worldAction("scout",kingdom.id)}>{kingdom.mission?.status==="pending"?"AJAN YOLDA":kingdom.discovered?"YENİDEN KEŞFET":"AJAN GÖNDER"}</button></article>)}</div></div>{game.notices.map((x,i)=><div className="report" key={i}><span>{x.kind}</span><p>{x.text}<small>{new Date(x.at).toLocaleTimeString("tr-TR",{hour:"2-digit",minute:"2-digit"})}</small></p></div>)}</div>}
 </div></aside>}<nav className="royal-navigation" aria-label="Ana menü">{mainSections.map(section=>{const active=panelOpen&&activeSection.id===section.id;return <button key={section.id} className={active?"active":""} onClick={()=>{if(active)setPanelOpen(false);else{setTab(section.first);setPanelOpen(true)}}} aria-current={active?"page":undefined}><span><GameIcon name={section.icon}/>{section.id==="savas"&&incomingAlerts>0&&<i>{incomingAlerts}</i>}</span><b>{section.label}</b></button>})}<small>Game-icons.net · CC BY 3.0</small></nav>{worldView&&<ChannelWorldMap channelName={game.channel} homeName={game.kingdomName} homeTerrain={game.terrain} homePosition={worldHome} extent={worldExtentValue} homeKeepLevel={lv} kingdoms={otherKingdoms} sharedMine={sharedMine} worldEvent={worldEvent} busy={worldBusy} formatLeft={at=>left(at,now)} relationFor={kingdom=>diplomaticStatusFor(kingdom as WorldKingdom)} onClose={()=>setWorldView(false)} onScout={id=>void worldAction("scout",id)} onDeepObserve={id=>void worldAction("deep_observation",id)} onMine={action=>void mineAction(action)} onNegotiate={id=>{setEnvoyTarget(id);setWorldView(false);setPanelOpen(false);setNegotiationOpen(true)}} onCampaign={id=>{setCampaignTarget(id);setWorldView(false);setTab("sefer");setPanelOpen(true)}}/>} {infoPanel&&
  // Geri planı tıklayınca kapanır; role="dialog" aria-query'de etkileşimli
  // sayılmadığı için jsx-a11y bunu statik eleman sanır. Klavye eşdeğeri Esc'tir.
  // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
  <div className="info-overlay" role="dialog" aria-modal="true" tabIndex={-1} onClick={()=>setInfoPanel(null)} onKeyDown={e=>{if(e.key==="Escape")setInfoPanel(null)}}>
  {/* Tıklama yalnızca üstteki kapatma tıklamasının karta sızmasını engeller; kartın kendisi bir eylem değildir. */}
  {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
  <div className="info-card" onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
   <button className="info-close" onClick={()=>setInfoPanel(null)} aria-label="Kapat">✕</button>
   {infoPanel==="hedef"
     ? <><span className="eyebrow">İLK HEDEF</span><h3>Ekonomiyi dengede tut</h3>
         <p>Yiyecek üretimini pozitif tutun; ardından Meydan veya Kışla kurun. Halkın istihkakı yiyecekten düşer, yani üretim açığı doğrudan rızaya vurur.</p></>
     : <><span className="eyebrow">GENERALİN AKTİF YETKİLERİ</span><h3>Neleri kendi uygular?</h3>
         <div className="authority-list">{["Yapı kur/yükselt","İnşaat hızlandır","Birlik eğit","Vergi ayarla","Şenlik düzenle","Doktrin kaydet","Madene işçi gönder","İşçileri geri çek","Ajan gönder","Karşı-istihbarat kur","Nöbet oranı","Asker maaşı","Gece emri"].map(x=><i key={x}>{x}</i>)}</div>
         <p>Rutin emirleri doğrudan uygular. Kaynak yetmiyorsa, kuyruk doluysa ya da halk riski varsa engeller veya teyit ister. Emir sayısını kısıtlayan bir kota yoktur; istediğin kadar danışabilirsin.</p>
         <p className="info-note">Vergi ve istihkakları Kral doğrudan çevirir — General uygulamaz ama her değişiklikte görüşünü söyler.</p></>}
  </div>
 </div>}
 {tutorialStep!==null&&<Tutorial step={tutorialStep} next={advanceTutorial} skip={closeTutorial}/>}</section></main>
}

const tutorial=[
 {eyebrow:"I · YENİ KRALLIK",title:"Önce başkentini ve arazini tanı",text:"Sv.1 ahşap kalen, üç başlangıç yapın ve dört günlük koruman var. Seçtiğin arazi haritanın coğrafyasını, üretim hızını ve savunmanı kalıcı olarak etkiler. Haritayı sürükleyerek döndür, tekerlekle yakınlaş."},
 {eyebrow:"II · MECLİS",title:"Generalini yönlendir ve ikna et",text:"Sen Kral olarak hedef ve gerekçe verirsin; General kaynakları, halkı, sadakatini ve yönetim doktrinini tartıp ayrıntıları kendisi yönetir. Riskli emirde itiraz edebilir."},
 {eyebrow:"III · BİNALAR",title:"Raporu oku, emri General'e ver",text:"Binalar sekmesi salt okunur bir durum raporudur. İnşa ve yükseltme için Meclis'te doğal dille emir ver; General uygun bulursa kuyruğu başlatır."},
 {eyebrow:"IV · DEFTER",title:"Karar için istihbarat topla",text:"Defterde saatlik değerleri izlersin fakat vergiyi düğmeyle değiştirmezsin. General'i rakamlar ve gerekçelerle ikna etmelisin."},
 {eyebrow:"V · DİYAR",title:"Koruma bitmeden hazırlan",text:"Dış dünya ilerledikçe açılır. Önce ekonomi ve kışla, sonra diplomasi ve fetih. Krallığın hesabına otomatik kaydedilir."},
];
function Tutorial({step,next,skip}:{step:number;next:()=>void;skip:()=>void}){const item=tutorial[step];return <div className="tutorial-layer"><section className="tutorial-card"><div className="tutorial-progress">{tutorial.map((_,i)=><i className={i<=step?"done":""} key={i}/>)}</div><p>{item.eyebrow}</p><h3>{item.title}</h3><span>{item.text}</span><div><button onClick={skip}>REHBERİ GEÇ</button><button className="primary-seal" onClick={next}>{step===tutorial.length-1?"OYUNA BAŞLA":"SONRAKİ"}</button></div></section></div>}

function Onboarding(p:{channels:Channel[];step:Setup;setStep:(s:Setup)=>void;selected:Channel;setSelected:(c:Channel)=>void;name:string;setName:(s:string)=>void;ruler:string;setRuler:(s:string)=>void;terrain:TerrainId;setTerrain:(s:TerrainId)=>void;provider:keyof typeof modelOptions;setProvider:(s:keyof typeof modelOptions)=>void;model:string;setModel:(s:string)=>void;apiKey:string;setApiKey:(s:string)=>void;found:(c:boolean)=>void;connect:()=>void;connecting:boolean;error:string}){return <main className="onboarding"><div className="onboarding-bg"><div className="distant-castle">♜</div></div><header className="onboarding-header"><div className="brand-mark">♜</div><div className="title-block"><h1>DEMİRKALE</h1><p>KRALLIK SİMÜLASYONU</p></div><span>KALICI DÜNYA · BYOK GENERAL</span></header>
 {p.step==="welcome"&&<section className="welcome-card"><p className="eyebrow">TAHT BOŞ · DİYAR SENİ BEKLİYOR</p><h2>Bir krallık miras almayacaksın.<br/><em>Onu sıfırdan kuracaksın.</em></h2><p>Boş bir dış çeper parseli, Kale Sv.1, yüz kişilik bir halk ve sınırlı erzak. Generalinize yön verin; ekonomi, diplomasi ve savaş siz çevrimdışıyken de yaşamaya devam etsin.</p><div className="starting-ledger"><span>1 Kale</span><span>100 Halk</span><span>1.000 Altın</span><span>4 Gün Koruma</span></div><button className="primary-seal" onClick={()=>p.setStep("channel")}>TAHTA DOĞRU İLERLE</button><small>Krallığın hesabına otomatik kaydedilir; başka bir tarayıcıdan kaldığın yerden devam edebilirsin.</small></section>}
 {p.step==="channel"&&<section className="setup-card"><div className="step-count">I / III</div><p className="eyebrow">BİR DÜNYA SEÇ</p><h2>Hangi channel&apos;da hüküm süreceksin?</h2><p>Her channel ayrı bir krallık ve ayrı bir sezondur. Yalnızca yönetimin aktif tuttuğu dünyalar listelenir.</p><div className="channel-list">{p.channels.map(c=><button key={c.id} className={p.selected.id===c.id?"selected":""} onClick={()=>p.setSelected(c)}><i>♜</i><div><b>{c.name}</b><span>{c.detail}</span></div><strong>{c.remaining}</strong></button>)}</div><div className="setup-actions"><button onClick={()=>p.setStep("welcome")}>GERİ</button><button className="primary-seal" disabled={!p.selected} onClick={()=>p.setStep("kingdom")}>BU DÜNYAYA KATIL</button></div></section>}
 {p.step==="kingdom"&&<section className="setup-card"><div className="step-count">II / III</div><p className="eyebrow">SANCAĞINI DİK</p><h2>Krallığını kur</h2><div className="form-grid"><label>Hükümdarın adı<input value={p.ruler} onChange={e=>p.setRuler(e.target.value)} placeholder="Örn. Alaric" maxLength={30}/></label><label>Krallığın adı<input value={p.name} onChange={e=>p.setName(e.target.value)} placeholder="Örn. Demirkale" maxLength={36}/></label></div><p className="field-label">Başlangıç arazisi — görünüşü ve üretimi kalıcı olarak değiştirir</p><div className="terrain-list">{(Object.entries(terrainCatalog) as Array<[TerrainId,(typeof terrainCatalog)[TerrainId]]>).map(([id,item])=><button key={id} className={p.terrain===id?`selected ${id}`:id} onClick={()=>p.setTerrain(id)}><b>{item.label}</b><span>{item.bonus}</span></button>)}</div><div className="terrain-choice-detail"><b>{terrainCatalog[p.terrain].description}</b><span>{terrainCatalog[p.terrain].bonus}</span></div><div className="setup-actions"><button onClick={()=>p.setStep("channel")}>GERİ</button><button className="primary-seal" disabled={!p.name.trim()||!p.ruler.trim()} onClick={()=>p.setStep("general")}>PARSELİ TAHSİS ET</button></div></section>}
 {p.step==="general"&&<section className="setup-card"><div className="step-count">III / III</div><p className="eyebrow">GENERALİNİ UYANDIR</p><h2>BYOK modelini bağla</h2><p>Anahtarınız hesabınıza AES-GCM ile şifreli kaydedilir; tarayıcıya geri gönderilmez ve yalnızca seçtiğiniz sağlayıcıya istek yapılırken sunucuda çözülür.</p><div className="form-grid"><label>Sağlayıcı<select value={p.provider} onChange={e=>{const next=e.target.value as keyof typeof modelOptions;p.setProvider(next);p.setModel(modelOptions[next][0].id)}}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option></select></label><label>Model<select value={p.model} onChange={e=>p.setModel(e.target.value)}>{modelOptions[p.provider].map(option=><option value={option.id} key={option.id}>{option.label}</option>)}</select></label><label className="wide">API anahtarı<input type="password" value={p.apiKey} onChange={e=>p.setApiKey(e.target.value)} placeholder="Bağlanırken gerçek sağlayıcı isteğiyle doğrulanır" autoComplete="off"/></label></div>{p.error&&<div className="connection-error">{p.error}</div>}<div className="key-warning">Bağlantı bu hesapta kalıcıdır. Başka bir tarayıcıdan giriş yaptığınızda General otomatik olarak aynı sağlayıcı ve modelle bağlanır.</div><div className="setup-actions"><button onClick={()=>p.setStep("kingdom")}>GERİ</button><button onClick={()=>p.found(false)}>GENERAL SESSİZKEN BAŞLA</button><button className="primary-seal" disabled={p.connecting||!p.apiKey.trim()} onClick={p.connect}>{p.connecting?"DOĞRULANIYOR…":"GENERALİ BAĞLA VE TAHTA ÇIK"}</button></div></section>}
 </main>}
