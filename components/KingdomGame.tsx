"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import KingdomScene from "./KingdomScene";
import ChannelWorldMap from "./ChannelWorldMap";
import RichMessage from "./RichMessage";
import AccountGate, { type Account } from "./AccountGate";
import { applyActions, marketState } from "@/engine/actions";
import { catalog, keepSeconds, keepUpgradeCosts, resourceLabels, terrainCatalog } from "@/engine/catalog";
import { affordable, costFor, keep, rates, tick } from "@/engine/tick";
import { armySize, hourlyDemand, moodState, NEED, populationChange, rationsOf, suppression } from "@/engine/populace";
import { defenseOf, watchRatioOf } from "@/engine/raids";
import { applyPolicy, clampPolicy, type PolicyKey } from "@/engine/policy";
import type { Building as EngineBuilding, Game, GameAction, Key as EngineKey, Res as EngineRes, TerrainId as EngineTerrainId } from "@/engine/types";

type Key=EngineKey; type Res=EngineRes;
type Building=EngineBuilding;
type Tab="meclis"|"binalar"|"halk"|"ordu"|"defter"|"diyar"; type Setup="welcome"|"channel"|"kingdom"|"general";
type GeneralAction=GameAction;
type GeneralRequest={id:string;kind:string;text:string;severity:"normal"|"urgent";since:number};
type Channel={id:string;name:string;detail:string;speed:number;remaining:string;players?:number;maxPlayers?:number;durationDays?:number};
type IntelReport={id:string;name:string;ruler:string;terrain:string;keepLevel:number;population:number;buildingCount:number;army:number;resources:Record<string,number>};
type WorldKingdom={id:string;name:string|null;terrain:string;position:{x:number;z:number};ring:number;discovered:boolean;mission:{status:"pending"|"succeeded"|"failed"|"detected";completesAt:number;successChance:number}|null;report:IntelReport|null};
type SharedMine={personalCap?:number;channelSlots?:number;mine:{id:string;name:string;oreRemaining:number;extractedOre:number;totalWorkers:number;position:{x:number;z:number}};participants:Array<{id:string;name:string;workers:number;self:boolean}>};
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
const fmt=(n:number)=>new Intl.NumberFormat("tr-TR").format(Math.max(0,Math.round(n)));
const left=(at:number,now:number)=>{const s=Math.max(0,Math.ceil((at-now)/1000));return s>=3600?`${Math.floor(s/3600)}sa ${Math.floor(s%3600/60)}dk`:s>=60?`${Math.floor(s/60)}dk ${s%60}sn`:`${s}sn`};

export default function KingdomGame(){
 const[ready,setReady]=useState(false),[account,setAccount]=useState<Account|null|undefined>(undefined),[setup,setSetup]=useState<Setup>("welcome"),[availableChannels,setAvailableChannels]=useState<Channel[]>(fallbackChannels),[selected,setSelected]=useState<Channel>(fallbackChannels[2]);const[name,setName]=useState(""),[ruler,setRuler]=useState(""),[terrain,setTerrain]=useState<TerrainId>("plain"),[provider,setProvider]=useState<keyof typeof modelOptions>("openai"),[model,setModel]=useState("gpt-5.6-terra"),[apiKey,setApiKey]=useState("");
 const[game,setGame]=useState<Game|null>(null),[now,setNow]=useState(Date.now()),[tab,setTab]=useState<Tab>("meclis"),[night,setNight]=useState(false),[autoRotate,setAutoRotate]=useState(true),[marketOpen,setMarketOpen]=useState(false),[worldView,setWorldView]=useState(false),[message,setMessage]=useState(""),[chat,setChat]=useState<Array<{who:string;text:string}>>([]),[toast,setToast]=useState(""),[connecting,setConnecting]=useState(false),[generalError,setGeneralError]=useState(""),[showConnect,setShowConnect]=useState(false),[tutorialStep,setTutorialStep]=useState<number|null>(null),[cloudReady,setCloudReady]=useState(false),[cloudStatus,setCloudStatus]=useState("BULUT ARANIYOR"),[cloudUser,setCloudUser]=useState(""),[storedByok,setStoredByok]=useState(false),[replaceByok,setReplaceByok]=useState(false),[otherKingdoms,setOtherKingdoms]=useState<WorldKingdom[]>([]),[worldDefense,setWorldDefense]=useState<{active:boolean;activeUntil:number|null}>({active:false,activeUntil:null}),[incomingAlerts,setIncomingAlerts]=useState(0),[worldHome,setWorldHome]=useState<{x:number;z:number;ring:number;biome:string}>({x:0,z:0,ring:0,biome:"plain"}),[worldExtentValue,setWorldExtentValue]=useState(60),[sharedMine,setSharedMine]=useState<SharedMine|null>(null),[worldBusy,setWorldBusy]=useState(false),[generalRequests,setGeneralRequests]=useState<GeneralRequest[]>([]),[infoPanel,setInfoPanel]=useState<"hedef"|"yetki"|null>(null);
 const lastCloudSave=useRef(0),saving=useRef(false),worldRefresh=useRef<(()=>void)|null>(null),chatEnd=useRef<HTMLDivElement|null>(null);
 // Yeni mesaj gelince sohbet dibe kaysın; uzun konuşmada son söz görünmez kalıyordu.
 useEffect(()=>{chatEnd.current?.scrollIntoView({behavior:"smooth",block:"end"})},[chat,connecting]);
 useEffect(()=>{let local:Game|null=null;localStorage.removeItem(LEGACY_STORE);void(async()=>{try{const authResponse=await fetch("/api/auth",{cache:"no-store"});const authData=await authResponse.json() as {user?:Account|null};if(!authResponse.ok||!authData.user){setAccount(null);setReady(true);return}setAccount(authData.user);setCloudUser(authData.user.displayName);const savedLocal=localStorage.getItem(storeKey(authData.user.id));if(savedLocal)try{local=JSON.parse(savedLocal) as Game}catch{localStorage.removeItem(storeKey(authData.user.id))}const [saveResponse,channelResponse,byokResponse]=await Promise.all([fetch("/api/save",{cache:"no-store"}),fetch("/api/channels",{cache:"no-store"}),fetch("/api/byok",{cache:"no-store"})]);const data=await saveResponse.json() as {game?:Game|null};if(!saveResponse.ok)throw new Error("Bulut kaydı açılamadı");const byokData=await byokResponse.json() as {connected?:boolean;provider?:keyof typeof modelOptions;model?:string};if(byokResponse.ok&&byokData.connected&&byokData.provider&&byokData.model){setStoredByok(true);setProvider(byokData.provider);setModel(byokData.model)}const channelData=await channelResponse.json() as {channels?:Array<{id:string;name:string;speed:number;durationDays:number;maxPlayers:number;players:number;endsAt?:string|null}>};if(channelResponse.ok&&channelData.channels?.length){const mapped=channelData.channels.map(channel=>{const days=channel.endsAt?Math.max(0,Math.ceil((new Date(channel.endsAt).getTime()-Date.now())/86_400_000)):channel.durationDays;return{id:channel.id,name:channel.name,speed:channel.speed,durationDays:channel.durationDays,maxPlayers:channel.maxPlayers,players:Number(channel.players),detail:`${channel.durationDays} gün · ×${channel.speed} tempo · ${Number(channel.players)}/${channel.maxPlayers} Kral`,remaining:`${days} gün`}});setAvailableChannels(mapped);setSelected(mapped[0])}const source=data.game||local;if(source)setGame({...tick(source,Date.now()),provider:byokData.connected?byokData.provider??source.provider:source.provider,model:byokData.connected?byokData.model??source.model:source.model,generalConnected:Boolean(byokData.connected)});setCloudStatus(data.game?"BULUTTAN YÜKLENDİ":"BULUT HAZIR")}catch{if(local)setGame({...tick(local,Date.now()),generalConnected:false});setCloudStatus("YEREL YEDEK")}finally{setCloudReady(true);setReady(true)}})();},[]);
 useEffect(()=>{const id=setInterval(()=>{const n=Date.now();setNow(n);setGame(g=>g?tick(g,n):null)},1000);return()=>clearInterval(id)},[]);
 useEffect(()=>{if(!game){setOtherKingdoms([]);setSharedMine(null);return}const channelId=game.channelId??availableChannels.find(channel=>channel.name===game.channel)?.id;if(!channelId)return;if(!game.channelId)setGame(current=>current?{...current,channelId}:current);let active=true;const loadWorld=async()=>{try{const [worldResponse,mineResponse]=await Promise.all([fetch(`/api/world?channelId=${encodeURIComponent(channelId)}`,{cache:"no-store"}),fetch(`/api/mine?channelId=${encodeURIComponent(channelId)}`,{cache:"no-store"})]);const worldData=await worldResponse.json() as {kingdoms?:WorldKingdom[];defense?:{active:boolean;activeUntil:number|null};incomingAlerts?:number;home?:{x:number;z:number;ring:number;biome:string};extent?:number};const mineData=await mineResponse.json() as SharedMine;if(active&&worldResponse.ok){setOtherKingdoms(worldData.kingdoms??[]);setWorldDefense(worldData.defense??{active:false,activeUntil:null});setIncomingAlerts(worldData.incomingAlerts??0);if(worldData.home)setWorldHome(worldData.home);if(worldData.extent)setWorldExtentValue(worldData.extent)}if(active&&mineResponse.ok)setSharedMine(mineData)}catch{if(active)setOtherKingdoms([])}};worldRefresh.current=()=>void loadWorld();void loadWorld();const timer=setInterval(()=>void loadWorld(),10_000);return()=>{active=false;worldRefresh.current=null;clearInterval(timer)}},[game?.channelId,game?.channel,availableChannels]);
  useEffect(()=>{if(game&&ready&&account)localStorage.setItem(storeKey(account.id),JSON.stringify(game));if(!game||!cloudReady||saving.current||Date.now()-lastCloudSave.current<5000)return;saving.current=true;lastCloudSave.current=Date.now();setCloudStatus("KAYDEDİLİYOR");void fetch("/api/save",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({game})}).then(response=>{if(!response.ok)throw new Error();setCloudStatus("BULUTA KAYDEDİLDİ")}).catch(()=>setCloudStatus("YEREL YEDEK")).finally(()=>{saving.current=false})},[game,ready,cloudReady,account]);
 const lv=game?keep(game):1,rt=useMemo(()=>game?rates(game):null,[game]);
 // Halkin durumu: uretim carpani ve is birakma esigi buradan okunur.
 const mood=useMemo(()=>game?moodState(game.popularity,suppression(armySize(game.units),game.population,game.soldierUnrest??0)):{id:"uneasy" as const,label:"—",production:1,populationRate:0,populationPerHour:0},[game]);
 function found(connected:boolean,introduction?:string){const t=Date.now(),terrainInfo=terrainCatalog[terrain];const g:Game={version:2,kingdomName:name.trim(),rulerName:ruler.trim(),channel:selected.name,channelId:selected.id,speed:selected.speed,terrain,foundedAt:t,lastTickAt:t,protectionEndsAt:t+4*86_400_000,resources:{gold:1000,food:500,stone:300,wood:300,iron:100,ale:0},population:100,capacity:150,popularity:50,reputation:50,loyalty:75,taxRate:15,quota:2,quotaAt:t,buildings:[{type:"keep",name:"Kale",category:"Yönetim",level:1},{type:"wheat_farm",name:"Buğday Tarlası",category:"Ekonomi",level:1},{type:"lumberjack",name:"Oduncu Kulübesi",category:"Ekonomi",level:1}],units:{spearman:0},foodRation:100,aleRation:0,soldierPay:100,soldierUnrest:0,queue:null,notices:[{kind:"ARAZİ",text:`${terrainInfo.label} parseli tahsis edildi: ${terrainInfo.bonus}.`,at:t},{kind:"KURULUŞ",text:"Krallığınız dış çeperdeki boş parsele kuruldu. Dört günlük korumanız başladı.",at:t}],provider:connected?provider:null,model:connected?model:null,generalConnected:connected,strategyNote:"Ekonomiyi dengede tut, halkı aç bırakma ve koruma bitene kadar savunmayı hazırla."};void fetch("/api/channels",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({channelId:selected.id})}).then(async response=>{if(!response.ok){const data=await response.json() as {error?:string};setToast(data.error||"Channel katılımı kaydedilemedi.")}});setGame(g);setChat([{who:connected?"General Aldric":"Saray Kâtibi",text:connected?(introduction||"Bağlantı doğrulandı. İlk hedefinizi ve yönetim doktrinimizi belirleyin."):"General henüz sessiz. Üretim ve kuyruklar çalışır; yeni yönetim kararları için BYOK General'i bağlamalısınız."}]);if(!localStorage.getItem("demirkale.tutorial.done"))setTutorialStep(0)}
 function kingdomContext(g:Game|null){if(!g)return{name:name.trim(),ruler:ruler.trim(),terrain:terrainCatalog[terrain],keepLevel:1,population:100,popularity:50,loyalty:75,quota:2,strategyNote:"Henüz belirlenmedi",resources:{gold:1000,food:500,stone:300,wood:300,iron:100,ale:0},hourlyRates:{gold:3.3,food:14.5,stone:0,wood:22,iron:0,ale:0},buildings:[{name:"Kale",level:1},{name:"Buğday Tarlası",level:1},{name:"Oduncu Kulübesi",level:1}],units:{spearman:0},channelSpeed:selected.speed,channelId:selected.id,activeConstruction:null};const level=keep(g),buildTimes:Array<{type:string;name:string;nextLevel:number;seconds:number;cost:Partial<Res>}>=catalog.filter(item=>item.unlock<=level).map(item=>{const current=g.buildings.find(b=>b.type===item.type)?.level??0;return{type:item.type,name:item.name,nextLevel:current+1,seconds:Math.round(item.seconds/g.speed),cost:costFor(item.cost,current)}});if(level<6){buildTimes.unshift({type:"keep",name:"Kale",nextLevel:level+1,seconds:Math.round(keepSeconds[level]/g.speed),cost:keepUpgradeCosts[level]})}const gMood=moodState(g.popularity,suppression(armySize(g.units),g.population,g.soldierUnrest??0));
  // Nüfusun gerçek defteri: General uydurmak zorunda kalmasın.
  const nufus={mevcut:Math.round(g.population),kapasite:g.capacity,bosKonut:Math.floor(g.capacity-g.population),gunlukDegisim:Math.round(populationChange(gMood,g.population,g.capacity,g.buildings,24)),kurulustanBeriYerlesen:Math.round(g.peopleJoined??0),kurulustanBeriGocEden:Math.round(g.peopleLeft??0),madende:Math.round(g.mineWorkers??0),silahAltinda:armySize(g.units),halkinDurumu:gMood.label};
  const pazar=marketState(g,Date.now());
  return{name:g.kingdomName,ruler:g.rulerName,pazar:{seviye:pazar.level,gunlukHacim:pazar.limit,kalanHacim:pazar.left,satisFiyatlari:pazar.price,alisCarpani:pazar.spread},terrain:terrainCatalog[g.terrain]??terrainCatalog.plain,keepLevel:level,population:g.population,nufus,popularity:g.popularity,loyalty:g.loyalty,quota:g.quota,strategyNote:g.strategyNote??"Ekonomiyi dengede tut ve halkı aç bırakma.",resources:g.resources,hourlyRates:rates(g),buildings:g.buildings.map(b=>({name:b.name,level:b.level})),units:g.units,channelSpeed:g.speed,channelId:g.channelId??availableChannels.find(channel=>channel.name===g.channel)?.id,activeConstruction:g.queue?{name:g.queue.name,secondsRemaining:Math.max(0,Math.ceil((g.queue.completesAt-Date.now())/1000))}:null,buildTimes,
   // Maden, komşular ve nöbet durumu olmadan General bu alanlarda körlemesine karar verir.
   mine:sharedMine?{workers:sharedMine.participants.find(p=>p.self)?.workers??0,totalWorkers:sharedMine.mine.totalWorkers,oreRemaining:sharedMine.mine.oreRemaining}:null,
   neighbors:otherKingdoms.map((kingdom,index)=>({ordinal:index+1,name:kingdom.discovered&&kingdom.name?kingdom.name:"Bilinmeyen Sancak",discovered:kingdom.discovered,scouting:kingdom.mission?.status==="pending"})),
   counterIntelligence:{active:worldDefense.active,minutesRemaining:worldDefense.activeUntil?Math.max(0,Math.ceil((worldDefense.activeUntil-Date.now())/60_000)):0},
   protectionHoursLeft:Math.max(0,(g.protectionEndsAt-Date.now())/3_600_000),
   populace:(()=>{const r=rationsOf(g),army=armySize(g.units),state=moodState(g.popularity,suppression(army,g.population,g.soldierUnrest??0));
    return{mood:state.label,moodScore:Math.round(g.popularity),productionMultiplier:state.production,foodRation:r.food,aleRation:r.ale,soldierPay:r.soldierPay,army,soldierUnrest:Math.round(g.soldierUnrest??0),dailyFoodNeed:Math.round(g.population*NEED.food*24)}})(),
   defense:(()=>{const d=defenseOf(g);
    return{watchRatio:d.watch,watchers:d.watchers,wallLevel:d.wall,power:Math.round(d.power*10)/10,terrainDefense:terrainCatalog[g.terrain]?.defense??1,
     raidsRepelled:g.raidsRepelled??0,raidsSuffered:g.raidsSuffered??0,
     hoursSinceLastRaid:g.lastRaidAt?Math.round((Date.now()-g.lastRaidAt)/3_600_000):null,
     recentRaids:g.notices.filter(n=>n.kind==="AKIN").slice(0,3).map(n=>({text:n.text,hoursAgo:Math.round((Date.now()-n.at)/3_600_000)}))}})()}}
 function closeTutorial(){localStorage.setItem("demirkale.tutorial.done","1");setTutorialStep(null)}
 function advanceTutorial(){if(tutorialStep===null)return;const next=tutorialStep+1;if(next>=5)return closeTutorial();setTutorialStep(next);if(next===1)setTab("meclis");if(next===2)setTab("binalar");if(next===3)setTab("defter");if(next===4)setTab("diyar")}
 async function worldAction(action:"scout"|"defend",targetId?:string){if(!game?.channelId||worldBusy)return;setWorldBusy(true);try{const response=await fetch("/api/world",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,channelId:game.channelId,targetId})});const data=await response.json() as {error?:string;completesAt?:number;successChance?:number;activeUntil?:number};if(!response.ok)throw new Error(data.error||"Dünya emri uygulanamadı.");if(action==="defend")setWorldDefense({active:true,activeUntil:data.activeUntil??null});else setOtherKingdoms(items=>items.map(item=>item.id===targetId?{...item,mission:{status:"pending",completesAt:data.completesAt??Date.now(),successChance:data.successChance??10}}:item));setToast(action==="defend"?"Karşı-istihbarat nöbeti bir saatliğine kuruldu.":`Ajan yola çıktı · başarı ihtimali %${data.successChance??10}.`)}catch(error){setToast(error instanceof Error?error.message:"Dünya emri uygulanamadı.")}finally{setWorldBusy(false)}}
 async function mineAction(action:"join"|"leave"){if(!game?.channelId||worldBusy)return;const minersToSend=Math.max(1,Math.min(sharedMine?.personalCap??3,Math.round(game.population*.1)));setWorldBusy(true);try{const response=await fetch("/api/mine",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action,channelId:game.channelId,workers:minersToSend})});const data=await response.json() as {error?:string;workers?:number};if(!response.ok)throw new Error(data.error||"Maden emri uygulanamadı.");setGame(current=>current?{...current,mineWorkers:data.workers??0}:current);setToast(action==="join"?`Ortak madene ${data.workers??minersToSend} işçi gönderildi; o eller tarladan eksildi.`:"İşçiler ortak madenden çekildi, tarlaya döndüler.");const mineResponse=await fetch(`/api/mine?channelId=${encodeURIComponent(game.channelId)}`,{cache:"no-store"});if(mineResponse.ok)setSharedMine(await mineResponse.json() as SharedMine)}catch(error){setToast(error instanceof Error?error.message:"Maden emri uygulanamadı.")}finally{setWorldBusy(false)}}
 async function askGeneral(mode:"test"|"chat",text?:string){const history=chat.slice(-8).map(item=>({role:item.who===(game?.rulerName||ruler.trim())?"king":"general",text:item.text}));const response=await fetch("/api/general",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({provider,model,...(apiKey?{apiKey}:{}),mode,message:text,history,kingdom:kingdomContext(game)})});const data=await response.json() as {text?:string;actions?:GeneralAction[];error?:string;requests?:GeneralRequest[]};if(!response.ok)throw new Error(data.error||"General bağlantısı başarısız oldu.");setGeneralRequests(data.requests??[]);return{text:data.text||"General bağlantısı doğrulandı.",actions:data.actions??[]}}
 async function persistByok(){const response=await fetch("/api/byok",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({provider,model,apiKey})});const data=await response.json() as {error?:string};if(!response.ok)throw new Error(data.error||"BYOK bağlantısı kaydedilemedi.");setStoredByok(true);setReplaceByok(false);setApiKey("")}
 async function connectAndFound(){if(!apiKey.trim())return setGeneralError("API anahtarını girmelisiniz.");setConnecting(true);setGeneralError("");try{const intro=await askGeneral("test");await persistByok();found(true,intro.text)}catch(error){setGeneralError(error instanceof Error?error.message:"Bağlantı kurulamadı.")}finally{setConnecting(false)}}
 async function reconnectGeneral(){if(!game||(!apiKey.trim()&&!storedByok))return setGeneralError("API anahtarını girmelisiniz.");setConnecting(true);setGeneralError("");try{const intro=await askGeneral("test");if(apiKey.trim())await persistByok();setGame({...game,provider,model,generalConnected:true});setChat(x=>[...x,{who:"General Aldric",text:intro.text}]);setShowConnect(false);setToast("General bağlantısı hesaba şifreli olarak kaydedildi.")}catch(error){setGeneralError(error instanceof Error?error.message:"Bağlantı kurulamadı.")}finally{setConnecting(false)}}
 // Sunucu tarafı eylemler: sonuç metni her zaman API'nin gerçek cevabından üretilir.
 async function executeRemoteActions(actions:GeneralAction[],channelId:string|undefined){
  const results:string[]=[];
  if(!actions.length)return results;
  if(!channelId){actions.forEach(()=>results.push("✕ Bu emir için channel bilgisi çözülemedi."));return results}
  for(const action of actions){
   try{
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
 async function submitOrder(order:string){if(!game||!order.trim()||connecting)return;setChat(x=>[...x,{who:game.rulerName,text:order.trim()}]);setMessage("");setTab("meclis");if(!game.generalConnected){setChat(x=>[...x,{who:"Saray Kâtibi",text:"General bağlantısı etkin değil. Hesabındaki BYOK bağlantısını yenilemelisin."}]);setShowConnect(true);return}setConnecting(true);try{const answer=await askGeneral("chat",order.trim()),execution=applyActions(game,answer.actions,Date.now());if(answer.actions.length)setGame(execution.game);const remoteResults=await executeRemoteActions(execution.remote,game.channelId??availableChannels.find(channel=>channel.name===game.channel)?.id);const merged=[...execution.results,...remoteResults];const outcome=merged.length?`\n\n${merged.join("\n")}`:"";setChat(x=>[...x,{who:"General Aldric",text:`${answer.text}${outcome}`}]);if(remoteResults.some(line=>line.startsWith("✓")))worldRefresh.current?.()}catch(error){setChat(x=>[...x,{who:"Saray Kâtibi",text:error instanceof Error?error.message:"General yanıt veremedi."}]);setGame({...game,generalConnected:false});setShowConnect(true)}finally{setConnecting(false)}}
 // Kral politikayı doğrudan çevirir; General uygulamaz ama görüşünü söyler.
 function setPolicy(key:PolicyKey,value:number){
  if(!game)return;
  const result=applyPolicy(game,{key,value:clampPolicy(key,value)});
  setGame(result.game);
  setChat(x=>[...x,{who:"General Aldric",text:result.comment}]);
  setTab("meclis");
 }
 async function send(e:React.FormEvent){e.preventDefault();await submitOrder(message)}
 function reset(){if(confirm("Krallığınız hem buluttan hem bu cihazdan silinsin ve yeniden başlansın mı?")){void fetch("/api/save",{method:"DELETE"});if(account)localStorage.removeItem(storeKey(account.id));setGame(null);setSetup("welcome");setCloudStatus("BULUT HAZIR")}}
 async function logout(){await fetch("/api/auth",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"logout"})});if(account)localStorage.removeItem(storeKey(account.id));location.reload()}
 if(!ready)return <div className="boot-screen">DİYAR HAZIRLANIYOR…</div>;
 if(!account)return <AccountGate onAuthenticated={user=>{location.href=user.role==="admin"?"/admin":"/"}}/>;
 if(!game&&account.role==="admin")return <main className="account-gate"><div className="account-landscape"><i/><i/><i/></div><header><div className="brand-mark">♜</div><div className="title-block"><h1>DEMİRKALE</h1><p>YÖNETİCİ OTURUMU</p></div></header><section className="account-card admin-entry"><p className="eyebrow">YÖNETİM YETKİSİ DOĞRULANDI</p><h2>Yönetim Divanı hazır</h2><p>Channelları açıp kapatabilir, sezon ayarlarını belirleyebilir ve oyuncu hesaplarını yönetebilirsin.</p><a className="primary-seal" href="/admin">YÖNETİM DİVANINI AÇ</a><button onClick={logout}>YÖNETİCİ OTURUMUNU KAPAT</button></section></main>;
 if(!game)return <Onboarding channels={availableChannels} step={setup} setStep={setSetup} selected={selected} setSelected={setSelected} name={name} setName={setName} ruler={ruler} setRuler={setRuler} terrain={terrain} setTerrain={setTerrain} provider={provider} setProvider={setProvider} model={model} setModel={setModel} apiKey={apiKey} setApiKey={setApiKey} found={found} connect={connectAndFound} connecting={connecting} error={generalError}/>;
 return <main className={night?"app-shell night":"app-shell"}>{toast&&<button className="toast" onClick={()=>setToast("")}>{toast} ×</button>}{showConnect&&<div className="connect-overlay"><section className="connect-card"><button className="close-connect" onClick={()=>setShowConnect(false)}>×</button><p className="eyebrow">GENERALİ YENİDEN BAĞLA</p><h2>BYOK oturum bağlantısı</h2>{storedByok&&!replaceByok?<div className="stored-key"><b>✓ ANAHTAR HESABINDA KAYITLI</b><span>{provider} · {model}</span><button onClick={()=>setReplaceByok(true)}>ANAHTARI DEĞİŞTİR</button></div>:<div className="form-grid"><label>Sağlayıcı<select value={provider} onChange={e=>{const next=e.target.value as keyof typeof modelOptions;setProvider(next);setModel(modelOptions[next][0].id)}}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option></select></label><label>Model<select value={model} onChange={e=>setModel(e.target.value)}>{modelOptions[provider].map(option=><option value={option.id} key={option.id}>{option.label}</option>)}</select></label><label className="wide">API anahtarı<input type="password" value={apiKey} onChange={e=>setApiKey(e.target.value)} autoComplete="off" placeholder="API anahtarını gir"/></label></div>}{generalError&&<div className="connection-error">{generalError}</div>}<p className="privacy-note">Anahtar hesabına AES-GCM ile şifreli kaydedilir; tarayıcıya geri gönderilmez ve yalnızca sağlayıcı isteği sırasında çözülür.</p><button className="primary-seal connect-submit" disabled={connecting||((!storedByok||replaceByok)&&!apiKey.trim())} onClick={reconnectGeneral}>{connecting?"DOĞRULANIYOR…":storedByok&&!replaceByok?"KAYITLI BAĞLANTIYLA DEVAM":"BAĞLANTIYI KAYDET"}</button></section></div>}<header className="topbar"><div className="brand-mark">♜</div><div className="title-block"><h1>{game.kingdomName.toLocaleUpperCase("tr")}</h1><p>KRALLIK SİMÜLASYONU</p></div><div className="channel-chip"><span>● AKTİF</span><b>{game.channel}</b><small>Gün 1 · Koruma {left(game.protectionEndsAt,now)}</small></div><div className="cloud-chip" title={cloudUser||"Hesaba bağlı kayıt"}>☁ {cloudStatus}</div>{account.role==="admin"&&<a className="admin-link" href="/admin">YÖNETİM</a>}<button className="day-toggle" onClick={()=>{setTutorialStep(0);setTab("meclis")}}>？ REHBER</button><button className="day-toggle" onClick={()=>setNight(x=>!x)}>{night?"☾ GECE":"☀ GÜNDÜZ"}</button><button className="profile-button" onClick={reset}>{game.rulerName} · Sıfırla</button><button className="profile-button" onClick={logout}>Çıkış</button></header>
 <section className="resource-ribbon">{meta.map(([k,label])=><div className="resource" key={k}><span>{label}</span><strong>{fmt(game.resources[k])}</strong><small className={(rt?.[k]??0)<0?"negative":""}>{(rt?.[k]??0)>=0?"+":""}{(rt?.[k]??0).toFixed(1)}/sa</small></div>)}<div className="population"><span>HALKIN RIZASI</span><strong>{Math.round(game.popularity)}</strong><div className="meter"><i className={mood.id} style={{width:`${game.popularity}%`}}/></div><small><b className={`mood ${mood.id}`}>{mood.label}</b> · {Math.round(game.population)} / {game.capacity} nüfus</small></div></section>
 <section className="world-stage"><KingdomScene night={night} keepLevel={lv} developed={lv>=3&&game.buildings.length>=8} terrain={game.terrain} constructionName={game.queue?.kind==="building"?game.queue.name:undefined} buildings={game.buildings} population={game.population} capacity={game.capacity} army={armySize(game.units)} watchRatio={watchRatioOf(game)} mood={mood.id} autoRotate={autoRotate} seedKey={`${game.kingdomName}|${game.foundedAt}`}/><div className="scene-title"><button className="world-view-toggle" onClick={()=>setWorldView(true)}>CHANNEL HARİTASINI AÇ</button><button className={autoRotate?"rotate-toggle spinning":"rotate-toggle"} title={autoRotate?"Kamera dönüşünü durdur":"Kamerayı yeniden döndür"} onClick={()=>setAutoRotate(x=>!x)}>{autoRotate?"⟳ DÖNÜŞ AÇIK":"⏸ DÖNÜŞ DURDU"}</button><span>YENİ BAŞKENT · {(terrainCatalog[game.terrain]??terrainCatalog.plain).label}</span><h2>{game.kingdomName}</h2><p>Kale Sv.{lv} · {game.buildings.length} yapı · {Object.values(game.units).reduce((a,b)=>a+b,0)} asker</p><small>{(terrainCatalog[game.terrain]??terrainCatalog.plain).bonus} · {otherKingdoms.length} komşu sancak genel haritada</small></div>{(()=>{const pazar=marketState(game,now);
  const rows=([["food","Yiyecek"],["wood","Odun"],["stone","Taş"],["iron","Demir"],["ale","Bira"]] as Array<[Key,string]>);
  return <div className={marketOpen?"market-dock open":"market-dock"}>
   <button className="market-tab" onClick={()=>setMarketOpen(x=>!x)}>
    <span>⚖</span><b>PAZAR</b>{pazar.open.length>0&&<i>{pazar.open.length}</i>}
   </button>
   {marketOpen&&<div className="market-sheet">
    {!pazar.level
     ?<><div className="market-head"><b>Pazar kapalı</b><button onClick={()=>setMarketOpen(false)}>✕</button></div>
       <p className="market-note">Pazarımız yok; hiçbir kaynak altına çevrilemez. Kale Sv.2'de Pazar kurulabilir.</p></>
     :<><div className="market-head"><b>Pazar Sv.{pazar.level}</b><small>{pazar.freeSlots}/{pazar.slots} yuva boş · {pazar.left} birim hacim</small><button onClick={()=>setMarketOpen(false)}>✕</button></div>
       <p className="market-note">Mal tezgâha çıkar, parası teklif kapanınca gelir. Alış fiyatı satıştan {Math.round((pazar.spread-1)*100)}% yüksektir.</p>
       {pazar.open.length>0&&<div className="market-open">{pazar.open.map(order=><div className="open-order" key={order.id}>
         <div><b>{order.direction==="sell"?"Satışta":"Yolda"} · {order.amount} {(resourceLabels.find(([id])=>id===order.resource)?.[1]??order.resource).toLocaleLowerCase("tr-TR")}</b>
          <span>{order.direction==="sell"?`${order.gold} altın gelecek`:`${order.gold} altın ödendi`}</span></div>
         <strong>{left(order.completesAt,now)}</strong>
         <div className="order-progress"><i style={{width:`${Math.max(3,Math.min(100,(now-order.placedAt)/(order.completesAt-order.placedAt)*100))}%`}}/></div>
        </div>)}</div>}
       <div className="market-rows">{rows.map(([key,label])=>{const unit=pazar.price[key]??0;const have=Math.floor(game.resources[key]);const batch=Math.min(pazar.left,have,100);
        return <div className="market-row" key={key}>
         <div><b>{label}</b><span>Sat {unit} · Al {Math.ceil(unit*pazar.spread*100)/100} altın</span></div>
         <div className="market-actions"><small>{have}</small>
          <button disabled={connecting||batch<1||pazar.freeSlots<1} onClick={()=>void submitOrder(`Pazarda ${batch} ${label.toLocaleLowerCase("tr-TR")} sat.`)}>{pazar.freeSlots<1?"YUVA DOLU":batch<1?"YOK":`${batch} SAT`}</button></div>
        </div>})}</div></>}
   </div>}
  </div>})()}
{game.queue&&<div className="active-queue"><span>{game.queue.kind==="building"?"⚒ HARİTADA İNŞAAT":"EĞİTİM DEVAM EDİYOR"}</span><b>{game.queue.name}</b><strong>{left(game.queue.completesAt,now)}</strong><div className="queue-progress"><i style={{width:`${game.queue.startedAt?Math.max(4,Math.min(100,(now-game.queue.startedAt)/(game.queue.completesAt-game.queue.startedAt)*100)):8}%`}}/></div></div>}
 <aside className="council-panel"><div className="general-bars">{[["Sadakat",game.loyalty],["Halkın Rızası",Math.round(game.popularity)],["İtibar",game.reputation]].map(([label,value])=><div className="stat" key={label}><span>{label}</span><div><i style={{width:`${value}%`}}/></div><b>{value}</b></div>)}</div><nav className="tabs six">{(["meclis","binalar","halk","ordu","defter","diyar"] as Tab[]).map(x=><button key={x} className={tab===x?"active":""} onClick={()=>setTab(x)}>{x.toLocaleUpperCase("tr")}</button>)}</nav><div className="panel-content">
 {tab==="meclis"&&<div className="council-content"><div className="advisor"><div className="portrait">A</div><div><h3>{game.generalConnected?"General Aldric":"General sessiz"}</h3><p>{game.generalConnected?`${game.provider} · ${game.model}`:"BYOK bağlantısı bekleniyor"}</p></div>{!game.generalConnected&&<button className="reconnect-button" onClick={()=>{setGeneralError("");setShowConnect(true)}}>BAĞLA</button>}<span className={game.generalConnected?"online":"offline"}>●</span></div><div className="council-chips">
  <button onClick={()=>setInfoPanel("hedef")}>◆ İlk hedef</button>
  <button onClick={()=>setInfoPanel("yetki")}>◆ Generalin yetkileri</button>
 </div>{generalRequests.length>0&&<div className="general-requests">
  <span className="requests-head">GENERALİN TALEPLERİ</span>
  {generalRequests.map(request=><div key={request.id} className={`request ${request.severity}`}>
   <p>{request.text}</p>
   <button disabled={connecting} onClick={()=>void submitOrder(`Talebini karşılamak istiyorum: ${request.text}`)}>KARŞILA</button>
  </div>)}
 </div>}
 <div className="chat-log">{chat.map((x,i)=><div className={x.who===game.rulerName?"message king":"message"} key={i}><b>{x.who}</b><RichMessage text={x.text}/></div>)}{connecting&&<div className="message thinking"><b>GENERAL ALDRIC</b><p>Haritayı ve defterleri inceliyor…</p></div>}<div ref={chatEnd}/></div><form className="chat-form" onSubmit={send}><input value={message} onChange={e=>setMessage(e.target.value)} placeholder="Generalinize buyruğunuzu iletin…" disabled={connecting}/><button disabled={connecting}>✦</button></form></div>}
 {tab==="binalar"&&<div className="list-content"><div className="section-head"><span>{game.buildings.length} / {6+(lv-1)*2} YAPI · RAPOR</span><b>{game.queue?.kind==="building"?"1 kuyrukta":"General planlayabilir"}</b></div><div className="general-only-note"><b>Binaları General yönetir</b><span>Bir hedef ver veya onu ikna et: “Önce yiyeceği güvenceye al, sonra Meydan kur.”</span></div><button className="keep-card" disabled={lv>=6||connecting} onClick={()=>void submitOrder(`Kale yapısını Sv.${lv+1} seviyesine yükselt.`)}><span>♜</span><div><b>Kale Sv.{lv}{lv<6?` · sıradaki ${lv+1}`:" · Tavan"}</b><small>İdari kapasite ve emir kotası</small></div><strong>{lv>=6?"TAVAN":"EMİR VER"}</strong></button>{catalog.map(item=>{const current=game.buildings.find(b=>b.type===item.type)?.level??0,locked=item.unlock>lv,cost=costFor(item.cost,current);return <button className={`build-action ${locked?"locked":""}`} disabled={locked||connecting} onClick={()=>void submitOrder(current?`${item.name} yapısını Sv.${current+1} seviyesine yükselt.`:`${item.name} yapısını kur.`)} key={item.type}><span>{item.category}</span><div><b>{item.name} {current?`Sv.${current}`:"Kurulmadı"}</b><small>{locked?`Kale Sv.${item.unlock} gerekli`:item.detail}</small><em>Sonraki emir maliyeti · {Object.entries(cost).map(([k,v])=>`${k} ${v}`).join(" · ")}</em></div><strong>{locked?"KİLİTLİ":"EMİR VER"}</strong></button>})}</div>}
 {tab==="halk"&&(()=>{const r=rationsOf(game),army=armySize(game.units),demand=hourlyDemand(game),unrest=Math.round(game.soldierUnrest??0);
  const daily=(v:number)=>Math.round(v*24),brewery=game.buildings.some(b=>b.type==="brewery");
  const amenity=(type:string)=>game.buildings.find(b=>b.type===type)?.level??0;
  const step=(current:number,delta:number)=>Math.max(0,Math.min(200,current+delta));
  return <div className="populace-panel">
   <div className="section-head"><span>HALKIN DURUMU · RAPOR</span><b className={`mood ${mood.id}`}>{mood.label}</b></div>
   <div className="general-only-note"><b>Ferman senin, uygulama Generalin</b><span>Vergi ve istihkakları doğrudan çevirirsin; General uygulamaz ama her değişiklikte görüşünü söyler. Asker maaşı ve yapılar emirle yürür.</span></div>

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

 {tab==="ordu"&&<div className="army-panel"><div className="section-head"><span>GARNİZON · RAPOR</span><b>{game.units.spearman??0} asker</b></div><div className="general-only-note"><b>Orduyu General yönetir</b><span>Kaç asker istediğini veya savunma hedefini söyle. General nüfus ve yiyecek riski varsa itiraz eder.</span></div><div className="empty-army"><span>⚔</span><h3>{game.buildings.some(b=>b.type==="barracks")?"Kışla Generalin emrini bekliyor":"Henüz Kışlanız yok"}</h3><p>{game.buildings.some(b=>b.type==="barracks")?"Mızrakçı başına: 8 altın · 10 yiyecek · 1 demir":"Kışla kurulması için General'e stratejik gerekçeni ilet."}</p></div><div className="unit-row"><span>Mızrakçı</span><b>{game.units.spearman??0}</b><small>Savunma 16 · Hız 6</small></div>
  {(()=>{const d=defenseOf(game),watch=watchRatioOf(game),raids=game.notices.filter(n=>n.kind==="AKIN").slice(0,3);
   const step=(delta:number)=>Math.max(0,Math.min(100,watch+delta));
   return <><div className="watch-block">
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
    {raids.length?raids.map((n,i)=><p key={i}>{n.text}</p>):<p className="quiet">Dağlardan henüz akın gelmedi.</p>}
   </div></>;})()}
  </div>}
 {tab==="defter"&&<div className="ledger"><div className="section-head"><span>HAZİNE VE HALK · RAPOR</span><b>Tick canlı</b></div><div className="general-only-note"><b>Defter karar değil, istihbarattır</b><span>Vergi ve şenlik kararlarını General'e bildir; halkın rızasına göre uygulayabilir veya karşı çıkabilir.</span></div>{meta.map(([k,label])=><div key={k}><span>{label}</span><strong>{fmt(game.resources[k])}</strong><small className={(rt?.[k]??0)<0?"negative":""}>{(rt?.[k]??0).toFixed(1)}/sa</small></div>)}<div className="tax-control"><label>Mevcut vergi oranı <b>%{game.taxRate}</b></label><input type="range" min="0" max="50" value={game.taxRate} disabled/><small>Değiştirmek için General'i ikna etmelisin.</small></div></div>}
 {tab==="diyar"&&<div className="realm"><div className="section-head"><span>DIŞ ÇEPER · KORUMALI</span><b>{left(game.protectionEndsAt,now)}</b></div><div className={`terrain-summary ${game.terrain}`}><span>BAŞKENT ARAZİSİ</span><b>{(terrainCatalog[game.terrain]??terrainCatalog.plain).label}</b><p>{(terrainCatalog[game.terrain]??terrainCatalog.plain).description}</p><small>{(terrainCatalog[game.terrain]??terrainCatalog.plain).bonus}</small></div><div className="world-intel"><div className="intel-defense"><div><b>KARŞI-İSTİHBARAT</b><span>{worldDefense.active?`Nöbet etkin · ${left(worldDefense.activeUntil??now,now)}`:"Ajan savunması kapalı"}</span>{incomingAlerts>0&&<em>{incomingAlerts} düşman ajanı tespit edildi</em>}</div><button disabled={worldBusy||worldDefense.active} onClick={()=>void worldAction("defend")}>{worldDefense.active?"NÖBETTE":"NÖBET KUR"}</button></div>{sharedMine&&<div className="shared-mine"><span>⛏ CHANNEL ORTAK SAHASI</span><b>{sharedMine.mine.name}</b><small>{fmt(sharedMine.mine.extractedOre)} cevher çıkarıldı · {fmt(sharedMine.mine.oreRemaining)} kaldı · {sharedMine.mine.totalWorkers}/{sharedMine.channelSlots??60} yuva dolu</small><small className="mine-limit">Madenciler halkın içinden çıkar: nüfusunuzun en fazla %20'si ({sharedMine.personalCap??0} kişi). Madendeki her el tarlada eksiktir.</small><div>{sharedMine.participants.map(worker=><i key={worker.id}>{worker.name} · {worker.workers}</i>)}</div><button disabled={worldBusy} onClick={()=>void mineAction(sharedMine.participants.some(worker=>worker.self)?"leave":"join")}>{sharedMine.participants.some(worker=>worker.self)?"İŞÇİLERİ ÇEK":`${Math.max(1,Math.min(sharedMine.personalCap??3,Math.round(game.population*.1)))} İŞÇİ GÖNDER`}</button></div>}<div className="world-kingdoms"><div className="section-head"><span>AYNI CHANNEL · {otherKingdoms.length} SANCAK</span><b>İsimler keşifle açılır</b></div>{otherKingdoms.length===0?<p className="empty-world">Bu channel&apos;da henüz başka bir krallık yok.</p>:otherKingdoms.map(kingdom=><article className={kingdom.discovered?"kingdom-contact discovered":"kingdom-contact"} key={kingdom.id}><div><b>{kingdom.name??"Bilinmeyen Sancak"}</b><span>{terrainCatalog[kingdom.terrain as TerrainId]?.label??"BİLİNMEYEN BÖLGE"} · Haritada ({kingdom.position.x}, {kingdom.position.z})</span></div>{kingdom.report?<small>Kale Sv.{kingdom.report.keepLevel} · {kingdom.report.population} nüfus · {kingdom.report.army} asker · {kingdom.report.buildingCount} yapı</small>:kingdom.mission?.status==="pending"?<small>Ajan yolda · {left(kingdom.mission.completesAt,now)} · başarı %{kingdom.mission.successChance}</small>:<small>İçerik gizli · keşif başarı ihtimali düşük</small>}<button disabled={worldBusy||kingdom.mission?.status==="pending"} onClick={()=>void worldAction("scout",kingdom.id)}>{kingdom.mission?.status==="pending"?"AJAN YOLDA":kingdom.discovered?"YENİDEN KEŞFET":"AJAN GÖNDER"}</button></article>)}</div></div>{game.notices.map((x,i)=><div className="report" key={i}><span>{x.kind}</span><p>{x.text}<small>{new Date(x.at).toLocaleTimeString("tr-TR",{hour:"2-digit",minute:"2-digit"})}</small></p></div>)}</div>}
 </div></aside>{worldView&&<ChannelWorldMap channelName={game.channel} homeName={game.kingdomName} homeTerrain={game.terrain} homePosition={worldHome} extent={worldExtentValue} homeKeepLevel={lv} kingdoms={otherKingdoms} sharedMine={sharedMine} busy={worldBusy} formatLeft={at=>left(at,now)} onClose={()=>setWorldView(false)} onScout={id=>void worldAction("scout",id)} onMine={action=>void mineAction(action)}/>} {infoPanel&&<div className="info-overlay" role="dialog" aria-modal="true" onClick={()=>setInfoPanel(null)}>
  <div className="info-card" onClick={e=>e.stopPropagation()}>
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
