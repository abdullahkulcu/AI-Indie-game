"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { catalog } from "@/engine/catalog";

type MapKingdom = { id: string; name: string | null; terrain: string; position: { x: number; z: number }; discovered: boolean };
type MapMine = { name: string; position: { x: number; z: number }; totalWorkers: number };
/** Sahnenin bir yapıdan istediği her şey. Motorun `Building` tipi bu şekle uyar. */
type SceneBuilding = { type: string; level: number };
type Props = {
  night: boolean; keepLevel?: number; developed?: boolean; terrain?: string; constructionName?: string;
  kingdoms?: MapKingdom[]; sharedMine?: MapMine;
  /** Kurulu yapılar; her tür sahnede kendi silüetiyle çizilir. */
  buildings?: SceneBuilding[];
  population?: number; capacity?: number;
  /** Toplam asker sayısı; sahnedeki devriye figürlerinin sayısını belirler. */
  army?: number;
  /** Nöbet oranı (%0-100). Askerlerin kaçının sur hattında olduğunu belirler. */
  watchRatio?: number;
  /** Halkın ruh hâli: content | uneasy | simmering | strike | revolt. */
  mood?: string;
  /** Pasif kamera dönüşü. false verilirse kendiliğinden dönüş durur; sürükleyerek
   *  çevirmek her hâlükârda çalışmaya devam eder. */
  autoRotate?: boolean;
  /** Determinizm tohumu: aynı krallık her açılışta aynı sahneyi üretir. */
  seedKey?: string;
};

/** Bir eve düşen ortalama nüfus ve sahnedeki ev tavanı; 500 nüfusta sahne çökmemeli. */
const PEOPLE_PER_HOUSE = 6, HOUSE_CAP = 72;
const buildingNames = new Map<string, string>(catalog.map(item => [item.type, item.name]));

/** Arazi sahneye rengiyle, sisiyle ve örtüsüyle hâkim olur; tek tek değerler değil bütün bir manzara. */
const terrainPlans: Record<string, {
  ground: number; region: number; fog: number; fogDensity: number;
  grass: number; grassColor: number; trunk: number; canopy: number;
}> = {
  plain: { ground: 0x5c7540, region: 0x6b8548, fog: 0xd8c8a6, fogDensity: .005, grass: 210, grassColor: 0x718c47, trunk: 0x5f3e25, canopy: 0x33643a },
  forest: { ground: 0x2c4527, region: 0x35522f, fog: 0x9fae86, fogDensity: .0105, grass: 190, grassColor: 0x2f5528, trunk: 0x4a3220, canopy: 0x1f4425 },
  mountain: { ground: 0x5e6152, region: 0x6a6c5c, fog: 0xc3c4bb, fogDensity: .007, grass: 70, grassColor: 0x6b7458, trunk: 0x4f3a28, canopy: 0x3b5a3d },
  riverbank: { ground: 0x4f6f42, region: 0x5c7f4a, fog: 0xc6d3c4, fogDensity: .0075, grass: 175, grassColor: 0x62894a, trunk: 0x5a4029, canopy: 0x2f6038 },
};

export default function KingdomScene({
  night, keepLevel = 1, developed = false, terrain = "plain", constructionName,
  kingdoms = [], sharedMine, buildings = [], population = 0, capacity = 0,
  army = 0, watchRatio = 40, mood = "content", autoRotate = true, seedKey = "demirkale",
}: Props) {
  const mount = useRef<HTMLDivElement>(null); const nightRef = useRef(night);
  // Ruh hâli ve nöbet oranı sık değişir; imzaya girselerdi sahne her değişimde
  // baştan kurulurdu. Bunlar ref'ten okunur, animasyon döngüsü davranışı CANLI
  // günceller ve tek bir geometri bile yeniden yaratılmaz.
  const moodRef = useRef(mood), watchRef = useRef(watchRatio), autoRotateRef = useRef(autoRotate);
  const worldSignature = kingdoms.map(kingdom=>`${kingdom.id}:${kingdom.name??"?"}:${kingdom.discovered}:${kingdom.terrain}:${kingdom.position.x}:${kingdom.position.z}`).join("|")+`|mine:${sharedMine?.name??""}:${sharedMine?.position.x??""}:${sharedMine?.position.z??""}:${sharedMine?.totalWorkers??0}`;
  // Nüfus her tick'te ondalık oynar. Sahne 10 saniyede bir yeniden kurulmasın diye
  // ham sayı değil, ondan türeyen EV SAYISI ve doluluk kuşağı bağımlılık olur.
  const houseCount = Math.max(0, Math.min(HOUSE_CAP, Math.round(Math.max(0, population) / PEOPLE_PER_HOUSE)));
  const crowdBand = capacity > 0 ? Math.round(Math.min(1.2, Math.max(0, population) / capacity) * 5) : 0;
  const buildingSignature = buildings.map(item=>`${item.type}:${item.level}`).sort().join(",");
  // Asker sayısı örnek KAPASİTESİNİ belirlediği için imzaya girmek zorunda; ham
  // sayı değil bantlanmış figür sayısı girer, böylece tek asker eğitmek sahneyi
  // yeniden kurmaz.
  const soldierCount = Math.max(0, Math.min(28, Math.round(Math.max(0, army) / 5)));
  useEffect(() => { nightRef.current = night; }, [night]);
  useEffect(() => { moodRef.current = mood; watchRef.current = watchRatio; }, [mood, watchRatio]);
  // Dönüşü açıp kapatmak sahneyi yeniden kurmamalı; ref'ten okunur.
  useEffect(() => { autoRotateRef.current = autoRotate; }, [autoRotate]);
  useEffect(() => {
    const host = mount.current; if (!host) return;
    const plan = terrainPlans[terrain] ?? terrainPlans.plain;
    const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(plan.fog, plan.fogDensity);
    const camera = new THREE.OrthographicCamera(-26, 26, 22, -22, .1, 400); let theta = Math.PI / 4, zoom = keepLevel === 1 ? 1.35 : 1.1;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; host.appendChild(renderer.domElement);
    const ambient = new THREE.HemisphereLight(0xffe3b8, 0x364425, 1.8); const sun = new THREE.DirectionalLight(0xffdca3, 2.6); sun.position.set(-25, 40, 20); sun.castShadow = true; scene.add(ambient, sun);

    // --- Paylaşılan geometri/materyal havuzu -------------------------------
    // Her kutu için yeni BufferGeometry açmak hem GPU tamponunu hem de temizlik
    // listesini şişiriyordu. Havuz sayesinde dispose tek yerden yapılır.
    const geometries = new Map<string, THREE.BufferGeometry>(), materials = new Map<string, THREE.Material>();
    const geom = <T extends THREE.BufferGeometry>(key: string, make: () => T): T => { const cached = geometries.get(key) as T | undefined; if (cached) return cached; const made = make(); geometries.set(key, made); return made; };
    const mat = (color: number) => { const key = `s${color}`; const cached = materials.get(key); if (cached) return cached; const made = new THREE.MeshStandardMaterial({ color, roughness: .82 }); materials.set(key, made); return made; };
    const glass = (color: number, opacity: number, roughness = .3) => { const key = `t${color}_${opacity}_${roughness}`; const cached = materials.get(key); if (cached) return cached; const made = new THREE.MeshStandardMaterial({ color, opacity, transparent: true, roughness }); materials.set(key, made); return made; };
    const tinted = (color: number) => { const key = `i${color}`; const cached = materials.get(key); if (cached) return cached; const made = new THREE.MeshStandardMaterial({ color, roughness: .82 }); materials.set(key, made); return made; };

    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = scene) => { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x,y,z); mesh.castShadow=true; mesh.receiveShadow=true; parent.add(mesh); return mesh; };
    const box=(w:number,h:number,d:number,c:number,x:number,y:number,z:number,p?:THREE.Object3D)=>add(geom(`b${w}|${h}|${d}`,()=>new THREE.BoxGeometry(w,h,d)),mat(c),x,y,z,p);
    const cylinder=(r:number,h:number,c:number,x:number,y:number,z:number,p?:THREE.Object3D)=>add(geom(`c${r}|${h}`,()=>new THREE.CylinderGeometry(r,r,h,12)),mat(c),x,y,z,p);
    const cone=(r:number,h:number,c:number,x:number,y:number,z:number,p?:THREE.Object3D)=>add(geom(`n${r}|${h}`,()=>new THREE.ConeGeometry(r,h,8)),mat(c),x,y,z,p);
    const ball=(r:number,c:number,x:number,y:number,z:number,p?:THREE.Object3D)=>add(geom(`s${r}`,()=>new THREE.SphereGeometry(r,10,8)),mat(c),x,y,z,p);
    /** Zemine yatık disk: meydan, tarla, gölet, açıklık. */
    const disc=(r:number,c:number,x:number,y:number,z:number,p?:THREE.Object3D)=>{const mesh=add(geom(`d${r}`,()=>new THREE.CircleGeometry(r,32)),mat(c),x,y,z,p);mesh.rotation.x=-Math.PI/2;mesh.castShadow=false;return mesh};
    /** Zemine yatık dörtgen: yol, nehir, iskele. */
    const slab=(w:number,d:number,c:number,x:number,y:number,z:number,p?:THREE.Object3D)=>{const mesh=add(geom(`p${w}|${d}`,()=>new THREE.PlaneGeometry(w,d)),mat(c),x,y,z,p);mesh.rotation.x=-Math.PI/2;mesh.castShadow=false;return mesh};

    // --- Determinizm ------------------------------------------------------
    // Tek bir akış kullanılırsa yeni bir üretici eklemek sonrakilerin hepsini
    // kaydırıyor. Her öğe kendi tuzuyla bağımsız akış alır, sahne stabil kalır.
    const hash=(text:string)=>{let value=2166136261;for(let i=0;i<text.length;i++){value^=text.charCodeAt(i);value=Math.imul(value,16777619)}return value>>>0};
    const makeRandom=(salt:string)=>{let state=(hash(`${seedKey}|${terrain}|${salt}`)||1)>>>0;return()=>{state=(state*1664525+1013904223)>>>0;return state/4294967296}};
    const dummy=new THREE.Object3D();

    // --- Yer tutma --------------------------------------------------------
    // Dekor (ağaç, kaya, sazlık) yalnızca boş yere kurulur. İki tür rezerv var:
    //  - katı: su, yapı, kale. Hem dekor hem ev buradan uzak durur.
    //  - yumuşak: sokak koridorları. Dekor girmez ama EVLER oraya kurulur;
    //    aksi hâlde kendi sokağı evi engellerdi.
    const reserved:Array<{x:number;z:number;r:number;soft:boolean;solid:boolean}>=[];
    const reserve=(x:number,z:number,r:number,soft=false,solid=false)=>{reserved.push({x,z,r,soft,solid})};
    const isFree=(x:number,z:number,r:number,respectSoft=true)=>{for(const zone of reserved){if(zone.soft&&!respectSoft)continue;if((x-zone.x)**2+(z-zone.z)**2<(zone.r+r)**2)return false}return true};
    /**
     * Yürüyen figür için geçilebilirlik. Yerleşim rezervleri yapı GÖVDESİ değil
     * yerleştirme marjıdır; insan bir binanın iki adım yanından geçebilir, o
     * yüzden marjlar daraltılır. `solid` işaretli alanlar (su, kaya, kale) ise
     * fiziksel engeldir ve asla daraltılmaz.
     */
    const walkable=(x:number,z:number,pad=.35)=>{
      for(const zone of reserved){
        if(zone.soft)continue;
        const radius=zone.solid?zone.r:Math.max(zone.r*.55,Math.min(zone.r,.7));
        if((x-zone.x)**2+(z-zone.z)**2<(radius+pad)**2)return false;
      }
      return true;
    };

    const detail=new THREE.Group(), castle=new THREE.Group();
    // Figürler ayrı gruptadır: uzaklaşınca yalnızca onlar gizlenir. Eskiden
    // binalar da bu gruptaydı ve Kral uzaklaşınca şehir tamamen kayboluyordu.
    const figures=new THREE.Group(); scene.add(detail,castle,figures);
    const spinners:THREE.Object3D[]=[]; // Değirmen kanadı gibi dönen parçalar.
    // Dağda kasaba bir sahanlığın üstünde durur: çevre zemin AŞAĞI iner, kasaba
    // y=0'da kalır. Zemini yukarı kaldırmak düz yapıları (tarla gibi) gömüyordu.
    const groundY=terrain==="mountain"?-2.7:-.08;
    const ground=disc(94,plan.ground,0,groundY,0); ground.receiveShadow=true;
    // Sahanlık kasabaya YER açacak kadar geniş olmalı; dar tutulunca 280 nüfuslu
    // krallık 15 haneye sıkışıyordu.
    if(terrain==="mountain"){const plateau=add(geom("plateau",()=>new THREE.CylinderGeometry(24,27,3.1,48)),mat(plan.region),0,-1.55,0);plateau.receiveShadow=true}
    const homeRegion=disc(terrain==="mountain"?23:26,plan.region,0,terrain==="mountain"?.012:-.03,0); homeRegion.receiveShadow=true;

    /** Ortak dağıtıcı: konumları verilen bir InstancedMesh kurar. */
    const scatter=(geometry:THREE.BufferGeometry,material:THREE.Material,spots:Array<{x:number;z:number;y?:number;s?:number;sy?:number;rot?:number;tilt?:number}>,parent:THREE.Object3D=detail)=>{
      if(!spots.length)return null;
      const mesh=new THREE.InstancedMesh(geometry,material,spots.length);
      spots.forEach((spot,index)=>{const s=spot.s??1;dummy.position.set(spot.x,spot.y??0,spot.z);dummy.rotation.set(spot.tilt??0,spot.rot??0,0);dummy.scale.set(s,spot.sy??s,s);dummy.updateMatrix();mesh.setMatrixAt(index,dummy.matrix)});
      mesh.instanceMatrix.needsUpdate=true;mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
    };
    /** Gövde + tepe olarak iki örneklemeyle ağaç kuşağı. */
    const treeBelt=(salt:string,count:number,inner:number,outer:number,trunkColor:number,crownColor:number,scale:number,avoid:boolean,base=0)=>{
      const random=makeRandom(salt),trunks:Array<{x:number;z:number;y:number;s:number;rot:number}>=[],crowns:typeof trunks=[];
      for(let i=0;i<count*3&&trunks.length<count;i++){
        const angle=random()*Math.PI*2,radius=inner+random()*(outer-inner),x=Math.cos(angle)*radius,z=Math.sin(angle)*radius,size=(.72+random()*.7)*scale;
        if(avoid&&!isFree(x,z,1.1))continue;
        trunks.push({x,z,y:base+.55*size,s:size,rot:random()*Math.PI});crowns.push({x,z,y:base+2.05*size,s:size,rot:random()*Math.PI});
        reserve(x,z,.85*size); // Ağaç da katı: ev bir ağacın içine kurulmasın.
      }
      scatter(geom("trunk",()=>new THREE.CylinderGeometry(.16,.24,1.15,6)),mat(trunkColor),trunks);
      scatter(geom("crown",()=>new THREE.ConeGeometry(.95,2.5,7)),mat(crownColor),crowns);
      return trunks.length;
    };

    // --- Önce yer, sonra dekor --------------------------------------------
    // Bu sıra kritik: kale, su ve YAPI YUVALARI dekordan ÖNCE rezerve edilir.
    // Tersi yapıldığında dağ arazisinde kayalar yapıların üstüne kuruluyor ve
    // krallığın yapıları sahnede kayboluyordu.
    // Kale + sur + hendek tek bir çekirdek alandır; dekor da yapı da dışında kalır.
    const hasWall=buildings.some(item=>item.type==="wall");
    const coreRadius=hasWall?(keepLevel>=4?13.6:11):keepLevel>=4?10.4:keepLevel>=3?8.4:6.2;
    reserve(0,0,coreRadius,false,true);

    // Araziye ait KATI engeller (su, doruk, damar) yuvalardan önce yerini alır.
    const peaks:Array<{x:number;z:number;height:number;width:number}>=[];
    const veins:Array<[number,number]>=[];
    if(terrain==="riverbank"){
      for(let i=-6;i<=6;i++)reserve(-12+i*1.1,i*8,7.6,false,true); // Nehir yatağı yapıya ve eve kapalı.
    }else if(terrain==="mountain"){
      const peakRandom=makeRandom("peaks");
      for(let i=0;i<9;i++){const angle=i/9*Math.PI*2+peakRandom()*.3,radius=31+peakRandom()*11,x=Math.cos(angle)*radius,z=Math.sin(angle)*radius;
        peaks.push({x,z,height:7+peakRandom()*7,width:3+peakRandom()*2.4});reserve(x,z,5,false,true)}
      const veinRandom=makeRandom("veins");
      for(let i=0;i<2;i++){const angle=veinRandom()*Math.PI*2,x=Math.cos(angle)*21,z=Math.sin(angle)*21;veins.push([x,z]);reserve(x,z,4.4,false,true)}
    }

    // Yapı yuvaları: kale çevresinde bir halka. Yuva doluysa (su, kaya) yapı
    // komşu boşluğa kayar; sahnede yapısız kalan bir krallık olmaz.
    const slotCount=14,slotPhase=hash(`${seedKey}|slots`)%360/360*Math.PI*2;
    const builtTypes=buildings.filter(item=>item.type!=="wall");
    const slots:Array<{item:SceneBuilding;x:number;z:number;angle:number}>=[];
    const SLOT_R=4.6;
    // İlk halka çekirdeğin DIŞINDA başlamalı. Sabit 12.4 kullanılırken Sv.4 + Sur
    // krallığında üç halkanın üçü de yasak alanın içinde kalıyor, arama hiçbir
    // boşluk bulamıyor ve yapı surun içine ya da nehrin üstüne kuruluyordu.
    const firstRing=coreRadius+SLOT_R+1.2;
    builtTypes.slice(0,slotCount).forEach((item,index)=>{
      const wanted=slotPhase+index*(Math.PI*2/slotCount);
      const base=firstRing+(index%3)*1.9;
      let picked:{x:number;z:number;angle:number}|null=null;
      // Halka halka dışa doğru tam tur tara. Eski arama yalnızca +3.2 birim
      // dışarı itebiliyordu; ihtiyaç ondan çok daha fazlaydı.
      search:for(let ring=0;ring<16&&!picked;ring++){
        const radius=base+ring*2.1;
        for(let step=0;step<24;step++){
          const da=(step%2?-1:1)*Math.ceil(step/2)*(Math.PI*2/28);
          const angle=wanted+da,x=Math.cos(angle)*radius,z=Math.sin(angle)*radius;
          if(isFree(x,z,SLOT_R)){picked={x,z,angle};break search}
        }
      }
      // Hiçbir boşluk kalmadıysa en dışa at; asla kontrolsüz konuma kurma.
      if(!picked){const radius=base+16*2.1;picked={x:Math.cos(wanted)*radius,z:Math.sin(wanted)*radius,angle:wanted}}
      slots.push({item,x:picked.x,z:picked.z,angle:picked.angle});reserve(picked.x,picked.z,SLOT_R);
    });

    // Sokaklar yumuşak rezerv: dekor girmez, evler tam da oraya dizilir.
    const streetCount=Math.max(2,Math.min(6,Math.ceil(Math.max(1,houseCount)/9)));
    const streetPhase=slotPhase+Math.PI/slotCount;
    const streets:number[]=[];for(let i=0;i<streetCount;i++)streets.push(streetPhase+i*(Math.PI*2/streetCount));
    const packing=1.18-crowdBand*.035;
    // Koridor evlerin bütün sıralarını kapsamalı; dar tutulunca arka sıralar ağaç
    // bölgesine düşüyor ve 300 nüfuslu krallık 13 haneye iniyordu. Genişlik nüfusla
    // büyür: kalabalık kasaba ormanı geri iter, küçük kasaba ağaçların arasında kalır.
    const corridor=3.2+Math.min(3.6,houseCount*.062);
    if(houseCount>0)for(const angle of streets)for(let d=6;d<=27;d+=2)reserve(Math.cos(angle)*d,Math.sin(angle)*d,corridor,true);

    // --- Arazi: sahneye asıl karakterini veren katman ----------------------
    const terrainLabels:Array<[string,number,number,number]>=[];
    const water:Array<{mesh:THREE.Mesh;base:number}>=[];
    if(terrain==="riverbank"){
      // Su sahneye hâkim: geniş yatak, sığ kıyı bandı, sazlık, iskele ve iki köprü.
      const river=slab(15,110,0x2c5f74,-12,.02,0);river.rotation.z=.1;
      const shallow=slab(19,110,0x3f7d8a,-12,.012,0);shallow.rotation.z=.1;
      const shimmer=slab(13,110,0x8fc7cf,-12,.03,0);shimmer.rotation.z=.1;(shimmer.material as THREE.Material).dispose();shimmer.material=glass(0x9fd6dd,.16);water.push({mesh:shimmer,base:.16});
      // Nemli kıyı: koyu, çamurlu bir bant.
      for(let i=-4;i<=4;i++)disc(4.4,0x46603d,-3.6+i*.35,.006,i*11);
      const reedRandom=makeRandom("reeds"),reeds:Array<{x:number;z:number;y:number;s:number;rot:number}>=[];
      for(let i=0;i<260;i++){const along=(reedRandom()-.5)*96,side=reedRandom()<.5?-1:1,offset=(7.4+reedRandom()*2.6)*side,x=-12+offset+along*.1,z=along,size=.6+reedRandom()*.85;reeds.push({x,z,y:.45*size,s:size,rot:reedRandom()*Math.PI})}
      scatter(geom("reed",()=>new THREE.ConeGeometry(.1,1.5,4)),mat(0x7f8f3c),reeds);
      const bridge=(z:number,width:number)=>{box(17,.4,width,0x7a5738,-11.5,.55,z);for(let i=-7;i<=7;i+=1.4){box(.22,1.1,.22,0x5d402c,-11.5+i,1.05,z-width/2);box(.22,1.1,.22,0x5d402c,-11.5+i,1.05,z+width/2)}box(15,.16,.16,0x6b4a30,-11.5,1.6,z-width/2);box(15,.16,.16,0x6b4a30,-11.5,1.6,z+width/2)};
      bridge(1,3.2);bridge(-19,2.2);
      // İskele ve bağlı kayık.
      box(3,.3,7,0x7d5a3a,-4.6,.5,13);for(const z of[10.5,13,15.5])cylinder(.2,1.6,0x5b3f2a,-4.6,.8,z);
      const boat=box(1.5,.55,3.4,0x6d4c30,-7,.35,13.4);boat.rotation.y=.2;box(.16,1.9,.16,0x53381f,-7,1.3,13.4);
      terrainLabels.push(["NEHİR BÖLGESİ",-18,4,-14],["TAHTA KÖPRÜ",-11.5,3,1],["İSKELE",-4.6,3,13]);
      // Kıyı ormanlık değil nemli otlaktır: ağaç seyrek, su ve sazlık baskın kalsın.
      treeBelt("willow",34,20,34,0x5a4029,0x2f6038,1.1,true);
      treeBelt("bankTrees",14,10,18,0x5a4029,0x357045,.85,true);
    }else if(terrain==="mountain"){
      // Yükselti kasabanın ÇEVRESİNDEDİR: sahanlık zaten kuruldu, doruklar
      // sahanlığın dışında ve alçak zeminde durur. Böylece dağ çerçeveler,
      // kasabanın üstünü örtmez.
      const skirt=add(geom("skirt",()=>new THREE.CylinderGeometry(27,31,1.6,48)),mat(0x636557),0,groundY+.8,0);skirt.receiveShadow=true;
      peaks.forEach((peak,i)=>{const {x,z,height,width}=peak;
        cone(width,height,i%2?0x5d6158:0x6b6a60,x,groundY+height/2,z);
        cone(width*.5,height*.36,0xa8a89e,x,groundY+height*.8,z); // açık renkli kaya kapağı
        cone(width*.6,height*.55,0x5a5d55,x+width*.9,groundY+height*.28,z-width*.5)});
      // Sahanlık kenarındaki kaya sırtı; yapı yuvaları zaten rezerve olduğu için
      // kayalar boşluklara oturur, yapıların üstüne binmez.
      const ridgeRandom=makeRandom("ridge");
      for(let i=0;i<46;i++){const angle=ridgeRandom()*Math.PI*2,radius=18+ridgeRandom()*5.5,x=Math.cos(angle)*radius,z=Math.sin(angle)*radius,size=.9+ridgeRandom()*1.3;
        if(!isFree(x,z,size+.4))continue;
        const rock=add(geom("bigRock",()=>new THREE.DodecahedronGeometry(1,0)),mat(ridgeRandom()<.4?0x7b7a70:0x63625a),x,size*.4,z);rock.scale.set(size,size*.75,size);rock.rotation.set(ridgeRandom(),ridgeRandom()*Math.PI,ridgeRandom());reserve(x,z,size,false,true)}
      // Cevher damarı: koyu kaya ve içinde parlayan demir.
      veins.forEach(([x,z])=>{const vein=add(geom("bigRock",()=>new THREE.DodecahedronGeometry(1,0)),mat(0x4a4740),x,.85,z);vein.scale.set(2.2,1.5,2.2);
        for(let i=0;i<4;i++)ball(.26,0xb4894a,x+(i-1.5)*.85,1.7,z+(i%2)*.7)});
      terrainLabels.push(["DAĞ BÖLGESİ",0,9,-30]);
      veins.forEach(([x,z],i)=>terrainLabels.push([i?"DEMİR DAMARI":"CEVHER DAMARI",x,3.4,z]));
      treeBelt("hardyPine",34,11,23,0x4f3a28,0x2f4a33,.72,true);
    }else if(terrain==="forest"){
      // Sahneyi çevreleyen ağaç duvarı, gölgeli zemin ve içeride açıklıklar.
      treeBelt("wallOuter",150,20,36,0x3f2b1c,0x18351d,1.45,false);
      treeBelt("wallInner",90,15,21,0x4a3220,0x1f4425,1.2,true);
      treeBelt("scattered",44,8,15,0x4a3220,0x27502b,.95,true);
      const shadeRandom=makeRandom("shade");
      for(let i=0;i<22;i++){const angle=shadeRandom()*Math.PI*2,radius=6+shadeRandom()*22,patch=disc(2.4+shadeRandom()*3.4,0x14260f,Math.cos(angle)*radius,.004,Math.sin(angle)*radius);patch.material=glass(0x14260f,.35,.9)}
      disc(9.5,0x5f7a3e,0,.008,0); // kasabanın oturduğu açıklık
      disc(5.5,0x6d8646,13,.008,-11);disc(4.4,0x6d8646,-14,.008,12);
      const path=slab(2.6,52,0x6f5f3f,9,.014,2);path.rotation.z=-.22;
      const fernRandom=makeRandom("ferns"),ferns:Array<{x:number;z:number;y:number;s:number;rot:number}>=[];
      for(let i=0;i<180;i++){const angle=fernRandom()*Math.PI*2,radius=7+fernRandom()*24,x=Math.cos(angle)*radius,z=Math.sin(angle)*radius;if(!isFree(x,z,.6))continue;const size=.55+fernRandom()*.9;ferns.push({x,z,y:.3*size,s:size,rot:fernRandom()*Math.PI})}
      scatter(geom("fern",()=>new THREE.SphereGeometry(.55,7,5)),mat(0x2b5029),ferns);
      terrainLabels.push(["ORMAN BÖLGESİ",-20,7,16],["AV YOLU",12,4,-14],["AÇIKLIK",13,3,-11]);
    }else{
      // Açık otlak: geniş tarla dokusu, kervan yolu, seyrek ağaç kümeleri.
      const fields:Array<[number,number,number,number]>=[[-20,13,7,0xb89552],[17,-16,6,0xa88b4a],[-17,-17,5.5,0x9d8b4d],[21,10,6.5,0xc0a05c]];
      fields.forEach(([x,z,radius,color])=>{disc(radius,color,x,.01,z);
        // Sürgü sıraları tarlayı uzaktan da tarla gibi gösterir.
        const furrows:Array<{x:number;z:number;y:number;s:number;rot:number}>=[];
        for(let i=-6;i<=6;i++){const offset=i*(radius/7);if(Math.abs(offset)>radius-.6)continue;furrows.push({x:x+offset,z,y:.09,s:1,rot:0,...{}})}
        scatter(geom(`furrow${radius}`,()=>new THREE.BoxGeometry(.3,.16,radius*1.7)),mat(0x8d7238),furrows);
        reserve(x,z,radius+1)});
      const road=slab(3.4,80,0x8b7750,4,.014,-2);road.rotation.z=.7;
      const road2=slab(2.4,70,0x84703f,-6,.012,6);road2.rotation.z=-1.15;
      // Otlak kümeleri: ova ağacı tek tek değil, üçer beşer durur.
      const copseRandom=makeRandom("copse");
      for(let i=0;i<7;i++){const angle=copseRandom()*Math.PI*2,radius=15+copseRandom()*16,cx=Math.cos(angle)*radius,cz=Math.sin(angle)*radius;
        if(!isFree(cx,cz,3))continue;
        for(let t=0;t<2+Math.floor(copseRandom()*3);t++){const size=.85+copseRandom()*.6,x=cx+(copseRandom()-.5)*4,z=cz+(copseRandom()-.5)*4;cylinder(.18,1.1*size,0x5f3e25,x,.55*size,z,detail);cone(.95*size,2.3*size,0x33643a,x,1.75*size,z,detail)}
        reserve(cx,cz,3.5)}
      // Saman balyaları hasat hissi verir.
      const hayRandom=makeRandom("hay");
      for(let i=0;i<9;i++){const angle=hayRandom()*Math.PI*2,radius=13+hayRandom()*14,x=Math.cos(angle)*radius,z=Math.sin(angle)*radius;if(!isFree(x,z,1.4))continue;const bale=cylinder(.75,1.5,0xc8a95e,x,.75,z,detail);bale.rotation.z=Math.PI/2;reserve(x,z,1.4)}
      terrainLabels.push(["OVA BÖLGESİ",-20,4,13],["KERVAN YOLU",14,4,10],["HASAT TARLASI",17,4,-16]);
      treeBelt("plainEdge",30,20,34,0x5f3e25,0x33643a,1,true);
    }

    // Çimen bütün arazilerde var ama yoğunluğu ve rengi araziye göre değişir.
    const grassRandom=makeRandom("grass"),grassSpots:Array<{x:number;z:number;y:number;s:number;rot:number}>=[];
    for(let i=0;i<plan.grass*2&&grassSpots.length<plan.grass;i++){const angle=grassRandom()*Math.PI*2,radius=3+grassRandom()*26,x=Math.cos(angle)*radius,z=Math.sin(angle)*radius;if(!isFree(x,z,.4))continue;const size=.7+grassRandom()*1.1;grassSpots.push({x,z,y:.26*size,s:size,rot:grassRandom()*Math.PI})}
    const grass=scatter(geom("grass",()=>new THREE.ConeGeometry(.17,.6,5)),mat(plan.grassColor),grassSpots);
    if(grass)grass.castShadow=false;

    const rockRandom=makeRandom("rocks"),rockSpots:Array<{x:number;z:number;y:number;s:number;sy:number;rot:number;tilt:number}>=[];
    const rockTarget=terrain==="mountain"?70:terrain==="riverbank"?26:18;
    for(let i=0;i<rockTarget*3&&rockSpots.length<rockTarget;i++){const angle=rockRandom()*Math.PI*2,radius=6+rockRandom()*20,x=Math.cos(angle)*radius,z=Math.sin(angle)*radius;if(!isFree(x,z,.9))continue;const size=.5+rockRandom()*1.3;rockSpots.push({x,z,y:.22*size,s:size,sy:size*.65,rot:rockRandom()*Math.PI,tilt:rockRandom()*.4})}
    scatter(geom("rock",()=>new THREE.DodecahedronGeometry(.45,0)),mat(terrain==="mountain"?0x74736a:0x6b695e),rockSpots);

    // --- Kale -------------------------------------------------------------
    if(keepLevel===1){
      // İlk seviye bir taş şato değil: küçük ahşap bir hükümdar konağı ve çıplak bir avlu.
      // Çatı gövdeden geniş olursa konak kahverengi bir yığına dönüşüyor; dört yüzlü
      // piramit gövdeye oturtulur ki ahşap duvarlar ve kapı görünsün.
      box(5,2.9,4,0x7d5940,0,1.45,0,castle);
      const roof=add(geom("keepRoof",()=>new THREE.ConeGeometry(3.4,1.9,4)),mat(0x4c2d24),0,3.85,0,castle);roof.rotation.y=Math.PI/4;
      box(.34,2.9,4.1,0x5f432e,-2.5,1.45,0,castle);box(.34,2.9,4.1,0x5f432e,2.5,1.45,0,castle); // köşe direkleri
      box(1.1,1.8,.2,0x3f2a1c,0,.9,2.02,castle);box(1.5,.2,.5,0x5f432e,0,1.9,2.1,castle); // kapı ve sundurma
      for(const x of[-1.9,1.9])box(.62,3.9,.62,0x5a402d,x,1.95,-1.6,castle); // gözcü kuleleri
      cylinder(.1,2.2,0x6b4a30,2.6,3.9,-1.6,castle);const banner=box(.05,.9,1.1,0x6d2028,2.6,4.5,-1.1,castle);void banner;
    }else{
      const castleScale=.76+Math.min(6,keepLevel)*.055;castle.scale.setScalar(castleScale);
      if(keepLevel===2){
        box(5.2,4.8,5.2,0x858078,0,2.4,0,castle);cone(4.1,2.3,0x641d26,0,6,0,castle);
        // Sv.2 yalnızca ahşap palisada sahiptir.
        for(let i=-5;i<=5;i+=1){cylinder(.16,2.2,0x5d422e,i,1.1,-5,castle);cylinder(.16,2.2,0x5d422e,i,1.1,5,castle);cylinder(.16,2.2,0x5d422e,-5,1.1,i,castle);cylinder(.16,2.2,0x5d422e,5,1.1,i,castle);}
      }else{
        cylinder(2.25,6.2,0x8b8374,0,3.1,0,castle);cone(2.8,2.5,0x641d26,0,7.45,0,castle);
        [[-5,-5],[5,-5],[-5,5],[5,5]].forEach(([x,z])=>{cylinder(1.15,4.6,0x777166,x,2.3,z,castle);cone(1.45,1.6,0x641d26,x,5.35,z,castle);});
        box(10.5,3.1,.65,0x6f6a61,0,1.55,-5,castle);box(10.5,3.1,.65,0x6f6a61,0,1.55,5,castle);box(.65,3.1,10.5,0x6f6a61,-5,1.55,0,castle);box(.65,3.1,10.5,0x6f6a61,5,1.55,0,castle);
        for(let i=-4.7;i<=4.7;i+=1.3){box(.55,.55,.55,0x5f5b54,i,3.35,-5,castle);box(.55,.55,.55,0x5f5b54,i,3.35,5,castle);}
      }
    }
    // Hendek surun DIŞINDA kalmalı; sabit yarıçapta bırakılınca sur duvarının
    // içinden geçip mavi bir halka gibi görünüyordu.
    if(keepLevel>=4){const inner=hasWall?11.6:8.4;const moat=add(geom(`moat${inner}`,()=>new THREE.RingGeometry(inner,inner+1.6,48)),mat(0x315f70),0,.005,0);moat.rotation.x=-Math.PI/2;moat.castShadow=false;reserve(0,0,inner+1.8,false,true)}

    // --- Yapı silüetleri ---------------------------------------------------
    // Her tür uzaktan tanınacak kendi silüetini kurar; seviye hem ölçekle hem de
    // eklenen parçalarla okunur (Sv.1 ile Sv.3 çıplak gözle ayrılmalı).
    const builders:Record<string,(group:THREE.Group,level:number)=>void>={
      wheat_farm:(group,level)=>{const field=slab(7.6,5.8,0xbf9a41,0,.03,0,group);field.receiveShadow=true;
        for(let i=-3;i<=3;i++)box(7,.14,.26,0xd8b552,0,.11,i*.8,group);
        box(2.3,1.7,1.9,0x8d6f4c,-3.9,.85,-2.6,group);const roof=cone(1.8,1.2,0x6d4326,-3.9,2.45,-2.6,group);roof.rotation.y=Math.PI/4;
        for(let i=0;i<level;i++)cylinder(.55,1.4,0xcfae5b,2.9-i*1.6,.7,2.7,group)},
      lumberjack:(group,level)=>{box(3.2,1.8,2.6,0x7a5636,0,.9,0,group);const roof=cone(2.5,1.4,0x53331f,0,2.5,0,group);roof.rotation.y=Math.PI/4;
        box(.9,.9,.9,0x604025,1.9,.45,1.6,group); // kütük kesme kütüğü
        for(let row=0;row<1+level;row++)for(let i=0;i<3;i++){const log=cylinder(.32,3,0x8a6238,-2.9,.35+row*.62,-1+i*.68,group);log.rotation.z=Math.PI/2}
        for(const spot of[[2.6,-1.8],[3.4,.4]] as Array<[number,number]>)cylinder(.45,.4,0x6b4a2c,spot[0],.2,spot[1],group)},
      quarry:(group,level)=>{// Basamaklı ocak: her seviye bir kademe daha açar.
        const steps=2+level;for(let i=0;i<steps;i++){const ring=disc(4.6-i*(3.2/steps),0x8b897d-i*0x0a0a09,0,.02+i*.012,0,group);ring.receiveShadow=true}
        for(let i=0;i<4+level;i++){const angle=i/(4+level)*Math.PI*2,x=Math.cos(angle)*5.3,z=Math.sin(angle)*5.3;box(1.1,.8,1.1,0x9a978b,x,.4,z,group)}
        box(.24,4.4,.24,0x6f4b2d,4.6,2.2,-3.4,group);box(3.4,.18,.18,0x6f4b2d,3.2,4.2,-3.4,group);box(.06,1.6,.06,0x2d231c,1.7,3.4,-3.4,group)},
      town_square:(group,level)=>{const plaza=disc(4.6,0xa79878,0,.02,0,group);plaza.receiveShadow=true;disc(2.8,0xb8a988,0,.03,0,group);
        cylinder(1.1,.9,0x8d8674,0,.45,0,group);for(const x of[-.9,.9])box(.2,1.9,.2,0x6b4a30,x,1.35,0,group);
        const canopy=cone(1.5,.9,0x6d2028,0,2.65,0,group);canopy.rotation.y=Math.PI/4;
        for(let i=0;i<2+level*2;i++){const angle=i/(2+level*2)*Math.PI*2,x=Math.cos(angle)*4,z=Math.sin(angle)*4;cylinder(.11,2.6,0x6b5335,x,1.3,z,group);const flag=box(.9,.6,.06,0xb03038,x+.45,2.3,z,group);flag.rotation.y=angle}},
      barracks:(group,level)=>{box(6.2,2.6,3.2,0x8a7c66,0,1.3,-1.6,group);box(6.6,.5,3.6,0x5c4430,0,2.75,-1.6,group);
        for(let i=0;i<3;i++)box(.7,1.2,.15,0x4b3a28,-2+i*2,.9,-.02,group); // kapılar
        const yard=slab(6.4,4.6,0x9a8b6c,0,.02,2.4,group);yard.receiveShadow=true;
        for(let i=-3;i<=3;i++){cylinder(.16,2,0x5d422e,i,1,4.8,group)} // avlu palisadı
        for(const x of[-3.2,3.2])for(let z=1;z<=4;z+=1.2)cylinder(.16,2,0x5d422e,x,1,z,group);
        for(let i=0;i<1+level;i++){const x=-2+i*1.8;cylinder(.16,1.7,0x6b4a30,x,.85,2.4,group);box(1.5,.18,.18,0x6b4a30,x,1.55,2.4,group);ball(.28,0x8d7048,x,1.85,2.4,group)} // talim mankeni
        if(level>=3){cylinder(.9,5,0x7d7263,3.6,2.5,-3.4,group);cone(1.2,1.4,0x4d2a26,3.6,5.7,-3.4,group)}},
      apple_orchard:(group,level)=>{const rows=2+level,cols=4,trunks:Array<{x:number;z:number;y:number;s:number;rot:number}>=[],crowns:typeof trunks=[],fruit:typeof trunks=[];
        for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){const x=(c-(cols-1)/2)*2.1,z=(r-(rows-1)/2)*2.1,size=.85;
          trunks.push({x,z,y:.5,s:size,rot:0});crowns.push({x,z,y:1.5,s:size,rot:0});
          fruit.push({x:x+.5,z:z+.2,y:1.7,s:1,rot:0});fruit.push({x:x-.45,z:z-.3,y:1.5,s:1,rot:0})}
        scatter(geom("orchardTrunk",()=>new THREE.CylinderGeometry(.15,.19,1,6)),mat(0x63432a),trunks,group);
        scatter(geom("orchardCrown",()=>new THREE.SphereGeometry(.95,9,7)),mat(0x3d7038),crowns,group);
        scatter(geom("apple",()=>new THREE.SphereGeometry(.14,6,5)),mat(0xb5342f),fruit,group);
        const grassPad=disc(rows*1.4,0x6f8a46,0,.01,0,group);grassPad.receiveShadow=true},
      mill:(group,level)=>{cylinder(1.4,3.8,0xc2ad82,0,1.9,0,group);const cap=cone(1.65,1.5,0x70242b,0,4.4,0,group);cap.rotation.y=Math.PI/4;
        const blades=new THREE.Group();blades.position.set(0,3.4,1.45);group.add(blades);spinners.push(blades);
        for(let i=0;i<4;i++){const arm=new THREE.Group();arm.rotation.z=i*Math.PI/2;box(.2,3+level*.2,.09,0xe4d0a5,0,1.5+level*.1,0,arm);blades.add(arm)}
        for(let i=0;i<level;i++)box(.8,.9,.6,0xd9c79a,2.4,.45,-1.2+i*1,group); // un çuvalları
        if(level>=3){cylinder(1,2.6,0xb5a077,-2.8,1.3,1.4,group);cone(1.2,1.1,0x70242b,-2.8,3.15,1.4,group)}},
      market:(group,level)=>{const floor=disc(4.4,0xa2916f,0,.02,0,group);floor.receiveShadow=true;
        for(let i=0;i<2+level;i++){const angle=i/(2+level)*Math.PI*2,x=Math.cos(angle)*2.6,z=Math.sin(angle)*2.6,stall=new THREE.Group();stall.position.set(x,0,z);stall.rotation.y=-angle;group.add(stall);
          for(const px of[-1.1,1.1])for(const pz of[-.8,.8])box(.14,1.6,.14,0x6b4a30,px,.8,pz,stall);
          const awning=box(2.6,.18,2,i%2?0xb03038:0xd8cbaa,0,1.7,0,stall);awning.rotation.x=.16;
          box(2.3,.5,.7,0x8d7048,0,1.05,-.5,stall);
          box(.6,.5,.5,0x7a5636,.7,.25,.6,stall);box(.5,.4,.45,0x8a6238,-.6,.2,.5,stall)}},
      wall:()=>{},
      mine:(group,level)=>{const mound=add(geom("bigRock",()=>new THREE.DodecahedronGeometry(1,0)),mat(0x6d6a60),0,1.1,-1.4,group);mound.scale.set(3.6,2.4,3);
        box(1.7,1.8,.5,0x241d16,0,.9,.6,group); // galeri ağzı
        for(const x of[-1,1])box(.3,2.1,.35,0x6b4a30,x,1.05,.85,group);box(2.5,.35,.35,0x6b4a30,0,2.25,.85,group);
        // Ahşap kule (headframe)
        for(const x of[-1.5,1.5])for(const z of[2.4,3.6]){const leg=box(.22,4,.22,0x74512f,x,2,z,group);leg.rotation.z=x>0?-.12:.12}
        box(3.6,.22,.22,0x74512f,0,4,3,group);cylinder(.5,.3,0x54534d,0,4.3,3,group);
        const rail=slab(1.6,7,0x5c5348,0,.03,5.5,group);rail.receiveShadow=true;
        for(let i=0;i<1+level;i++){box(1,.7,1.4,0x5d4a33,i%2?.9:-.9,.45,4.6+i*1.5,group)} // cevher arabaları
        for(let i=0;i<level;i++)cone(1.1,1.3,0x6f5a3c,-3.4-i*.2,.65,3+i*1.8,group)},
      park:(group,level)=>{const lawn=disc(4.6,0x59893f,0,.02,0,group);lawn.receiveShadow=true;
        const path=slab(1.5,9.2,0xa9946a,0,.03,0,group);path.receiveShadow=false;
        cylinder(1.5,.5,0x9d9483,0,.25,0,group);cylinder(1.15,.2,0x4f93a6,0,.55,0,group); // havuz
        cylinder(.22,1.3,0xa8a094,0,1.1,0,group);ball(.42,0x6fb6c9,0,1.9,0,group);
        for(let i=0;i<2+level;i++){const angle=i/(2+level)*Math.PI*2+.4,x=Math.cos(angle)*3.4,z=Math.sin(angle)*3.4;
          cylinder(.17,1.1,0x5c4028,x,.55,z,group);ball(1,0x3f7c3c,x,1.7,z,group)} // süs ağaçları
        for(const spot of[[-2.4,1.9],[2.4,-1.9]] as Array<[number,number]>){box(1.3,.16,.45,0x7d5a3a,spot[0],.42,spot[1],group);for(const dx of[-.45,.45])box(.14,.42,.4,0x6b4a30,spot[0]+dx,.21,spot[1],group)}
        for(let i=0;i<8;i++){const angle=i/8*Math.PI*2;box(1.5,.55,.4,0x2f5f2c,Math.cos(angle)*4.4,.28,Math.sin(angle)*4.4,group)}}, // çit
      brewery:(group,level)=>{box(4.4,2.4,3.2,0xa08356,0,1.2,-.6,group);const roof=cone(3.4,1.6,0x5b3a22,0,3.2,-.6,group);roof.rotation.y=Math.PI/4;
        cylinder(.55,3.4,0x8d7c63,1.6,1.7,-2,group);ball(.5,0xd8d2c4,1.6,3.7,-2,group);ball(.36,0xe2ddd2,1.9,4.4,-1.7,group); // baca ve buhar
        cylinder(1.25,1.9,0xa9702f,-2.8,.95,1.6,group);cylinder(1.35,.2,0x8a5a26,-2.8,1.95,1.6,group); // bakır kazan
        // Fıçılar seviye ile çoğalır; bira evinin uzaktan işareti budur.
        for(let i=0;i<3+level*2;i++){const barrel=cylinder(.62,1.3,0x7d4f2a,-1.6+(i%4)*1.35,.62,2.9+Math.floor(i/4)*1.5,group);barrel.rotation.z=Math.PI/2;
          const hoop=cylinder(.66,.14,0x4a3520,-1.6+(i%4)*1.35,.62,2.9+Math.floor(i/4)*1.5,group);hoop.rotation.z=Math.PI/2}},
      marriage_hall:(group,level)=>{box(5,2.8,3.6,0xd6cdb4,0,1.4,-.8,group);box(5.4,.4,4,0xb0463f,0,2.95,-.8,group);
        if(level>=3){ball(1.5,0xe4dcc6,0,3.6,-.8,group);cylinder(.14,1,0xc9a44a,0,4.9,-.8,group)} // Sv.3 kubbe
        for(let i=0;i<2+level;i++){const x=(i-(1+level)/2)*1.5;cylinder(.24,2.6,0xe6e0cd,x,1.3,1.2,group)} // sütunlar
        const arch=add(geom("arch",()=>new THREE.TorusGeometry(1.5,.19,8,18,Math.PI)),mat(0xc9a44a),0,0,3.4,group);
        for(let i=0;i<7;i++){const angle=Math.PI-i/6*Math.PI;ball(.22,i%2?0xd8607a:0xe8d76a,Math.cos(angle)*1.5,Math.sin(angle)*1.5,3.4,group)} // çiçek takı
        void arch;
        const aisle=slab(1.8,5,0xc9b48d,0,.03,4.6,group);aisle.receiveShadow=true;
        for(const x of[-1.6,1.6]){cylinder(.12,2.4,0xbfae8c,x,1.2,5.4,group);const pennant=box(.7,.5,.05,0xd8607a,x+.35,2.2,5.4,group);void pennant}
        for(const spot of[[-3,2.6],[3,2.6]] as Array<[number,number]>){disc(.9,0x4f8a3c,spot[0],.02,spot[1],group);for(let i=0;i<5;i++)ball(.18,i%2?0xd8607a:0xe8d76a,spot[0]+(i-2)*.32,.28,spot[1]+(i%2)*.3,group)}},
      theater:(group,level)=>{// Yarım daire basamaklar tiyatronun uzaktan da okunan imzası.
        const tiers=2+level;
        for(let i=0;i<tiers;i++){const radius=2.6+i*1.15,height=.55+i*.5;
          const tier=add(geom(`tier${radius}|${height}`,()=>new THREE.CylinderGeometry(radius,radius,height,26,1,false,0,Math.PI)),mat(i%2?0xbcb29a:0xaea488),0,height/2,0,group);tier.receiveShadow=true}
        const stage=box(6.2,.7,2.6,0xa2926f,0,.35,-2.2,group);stage.receiveShadow=true;
        box(6.6,3,.6,0xc8bda2,0,1.9,-3.4,group); // sahne arkası
        for(let i=0;i<4;i++)cylinder(.26,2.6,0xdcd3ba,-2.4+i*1.6,2.05,-2.4,group);
        box(6.6,.35,1.4,0x8c3b38,0,3.5,-2.8,group);
        if(level>=3)for(const x of[-3.4,3.4]){cylinder(.14,3,0xc9a44a,x,1.5,-1,group);const banner=box(.06,1.4,.9,0x6d2028,x,2.4,-.6,group);void banner}},
    };

    // Yapı meshleri, dekordan ÖNCE ayrılmış yuvalara kurulur.
    const placed:Array<{type:string;level:number;x:number;z:number}>=[];
    slots.forEach(slot=>{
      const build=builders[slot.item.type];if(!build)return;
      const group=new THREE.Group();group.position.set(slot.x,0,slot.z);group.rotation.y=-slot.angle+Math.PI/2;
      const level=Math.max(1,Math.min(6,slot.item.level||1));
      group.scale.setScalar(.84+Math.min(4,level)*.055); // Seviye ölçeği: Sv.1 ile Sv.3 gözle ayrılır.
      detail.add(group);build(group,level);
      placed.push({type:slot.item.type,level,x:slot.x,z:slot.z});
    });
    // Sur kaleyi çevreler; bir yuvada durmaz.
    const walls=buildings.filter(item=>item.type==="wall");
    if(walls.length){
      const level=Math.max(1,Math.min(6,walls[0].level||1)),radius=9.4,height=1.9+level*.45,thickness=.7+level*.12;
      // Mazgal dişleri tek tek Mesh olunca sur başına ~50 çizim çağrısı ediyordu;
      // hepsi tek InstancedMesh'te toplanır.
      const merlons:Array<{x:number;z:number;y:number;rot:number}>=[];
      for(let i=0;i<4;i++){const angle=i*Math.PI/2,x=Math.cos(angle)*radius,z=Math.sin(angle)*radius,facing=-angle+Math.PI/2;
        // Sur parçası yarıçapa DİK durmalı; `-angle` onu radyal çeviriyor ve dört
        // parça kaleyi saracağına artı işareti gibi duruyordu.
        const segment=box(radius*1.5,height,thickness,0x8e8578,x,height/2,z);segment.rotation.y=facing;
        for(let c=-radius*.7;c<=radius*.7;c+=1.5)merlons.push({x:x+Math.cos(facing)*c,z:z+Math.sin(facing)*c,y:height+.28,rot:facing})}
      scatter(geom(`merlon${thickness}`,()=>new THREE.BoxGeometry(.6,.55,thickness)),mat(0x6f6a61),merlons);
      for(let i=0;i<4;i++){const angle=i*Math.PI/2+Math.PI/4,x=Math.cos(angle)*radius*1.08,z=Math.sin(angle)*radius*1.08;
        cylinder(1.2,height+1.6,0x7f776a,x,(height+1.6)/2,z);cone(1.5,1.5,0x641d26,x,height+2.5,z)}
      reserve(0,0,radius+1.4,false,true);placed.push({type:"wall",level,x:0,z:-radius-1});
    }

    // --- Halkın evleri -----------------------------------------------------
    // Nüfus arttıkça sokaklar dışa doğru büyür, azaldığında en dıştaki haneler
    // boşalır. Konumlar sokak eksenine göre dizilir; üst üste binme rezervle biter.
    // Sokak dağda sahanlığın dışına taşmamalı; taşarsa alçak zeminin üstünde asılı kalır.
    const villageReach=terrain==="mountain"?22.5:27;
    if(houseCount>0)streets.forEach(angle=>{const street=slab(2.2,villageReach,0x7d6a48,Math.cos(angle)*villageReach/2,.012,Math.sin(angle)*villageReach/2);street.rotation.z=-angle+Math.PI/2;street.receiveShadow=false});
    const houseRandom=makeRandom("houses");
    const candidates:Array<{x:number;z:number;angle:number;variant:number}>=[];
    // Sokak başına iki sıra: yola bitişik haneler ve arka sıra. Adım küçük tutulur
    // ki kaya/ağaç yüzünden elenen aday nüfusu evsiz bırakmasın.
    for(let step=0;step<20;step++)for(const angle of streets)for(const side of[-1,1])for(const lane of[0,1,2]){
      const distance=(6.4+step*1.7)*packing+houseRandom()*.45;
      const lateral=(2.3+lane*1.95+houseRandom()*.45)*side;
      candidates.push({x:Math.cos(angle)*distance-Math.sin(angle)*lateral,z:Math.sin(angle)*distance+Math.cos(angle)*lateral,angle,variant:houseRandom()});
    }
    const homes:typeof candidates=[];
    // Evler kendi sokak koridorlarına kurulur (yumuşak rezerv yok sayılır), ama
    // su, kaya, ağaç ve yapı gibi katı engellere asla girmez.
    for(const spot of candidates){if(homes.length>=houseCount)break;if(Math.hypot(spot.x,spot.z)>villageReach)continue;if(!isFree(spot.x,spot.z,1.25,false))continue;homes.push(spot);reserve(spot.x,spot.z,1.25)}
    if(homes.length){
      const bodies=new THREE.InstancedMesh(geom("houseBody",()=>new THREE.BoxGeometry(1.7,1.25,1.4)),tinted(0xffffff),homes.length);
      const roofs=new THREE.InstancedMesh(geom("houseRoof",()=>new THREE.ConeGeometry(1.42,1,4)),tinted(0xffffff),homes.length);
      const wallTones=[0xc9b08a,0xb59a74,0xd3bd96,0xa88d68],roofTones=[0x7c3b2f,0x8d4a33,0x5f4a3a,0x6d3330];
      homes.forEach((home,index)=>{
        const size=.85+home.variant*.42,rotation=-home.angle+Math.PI/2;
        dummy.position.set(home.x,.62*size,home.z);dummy.rotation.set(0,rotation,0);dummy.scale.set(size,size,size);dummy.updateMatrix();bodies.setMatrixAt(index,dummy.matrix);
        dummy.position.set(home.x,(1.25*size)+.5*size,home.z);dummy.rotation.set(0,rotation+Math.PI/4,0);dummy.updateMatrix();roofs.setMatrixAt(index,dummy.matrix);
        bodies.setColorAt(index,new THREE.Color(wallTones[index%wallTones.length]));
        roofs.setColorAt(index,new THREE.Color(roofTones[Math.floor(home.variant*4)%roofTones.length]));
      });
      bodies.instanceMatrix.needsUpdate=true;roofs.instanceMatrix.needsUpdate=true;
      if(bodies.instanceColor)bodies.instanceColor.needsUpdate=true;if(roofs.instanceColor)roofs.instanceColor.needsUpdate=true;
      bodies.castShadow=roofs.castShadow=true;bodies.receiveShadow=roofs.receiveShadow=true;
      detail.add(bodies,roofs);
    }

    // --- Halk ve asker: mekaniği görünür kılan figürler --------------------
    // Bu blok yalnızca FİGÜR SAYISI değişince kurulur. Ruh hâli ve nöbet oranı
    // ref'ten okunduğu için davranış yeniden kurulmadan, canlı değişir.
    // Figür boyu: ev gövdesi ~1.25, çatıyla ~2.2 birim. Köylü ~0.95, asker ~1.1
    // birim; yapıların yanında inandırıcı, uzaktan da seçilebilir.
    const VILLAGER_Y=.47,SOLDIER_Y=.55;
    const walkRandom=makeRandom("walkers");
    // Yürüyüş hattı: sokak ekseni. Sokak koridoru zaten dekordan arındırılmış ve
    // evler yanlara dizilmiş durumda. Hat, KATI engele (su, kaya, yapı) çarptığı
    // yerde biter; böylece kimse nehre girmez ya da yapının içinden geçmez.
    // Hattın EN UZUN kesintisiz boş parçası aranır. İlk engelde durulursa yapı
    // yuvasının 4.6'lık rezervi sokağı ortasından kesiyor ve hiçbir hat elde
    // edilemiyordu (nehir kıyısında dört sokağın dördü de eleniyordu).
    const routes=streets.map(angle=>{
      const cos=Math.cos(angle),sin=Math.sin(angle);
      let best=0,bestStart=0,runStart=-1;
      for(let d=coreRadius+1.2;d<=villageReach;d+=.5){
        if(walkable(cos*d,sin*d)){if(runStart<0)runStart=d;const run=d-runStart;if(run>best){best=run;bestStart=runStart}}
        else runStart=-1;
      }
      return {angle,cos,sin,inner:bestStart,outer:bestStart+best};
    }).filter(route=>route.outer-route.inner>=3);
    // Grev toplanma yeri: Meydan varsa orası, yoksa kale önü.
    const square=placed.find(item=>item.type==="town_square");
    const rally=square?{x:square.x,z:square.z}
      :routes.length?{x:routes[0].cos*(coreRadius+2.4),z:routes[0].sin*(coreRadius+2.4)}
      :{x:coreRadius+2.4,z:0};

    // İsyan hedefi kurulum anında BİR KEZ doğrulanır: dışa doğru itilen nokta
    // suya ya da kayaya düşerse itiş kısaltılır. Döngüde ekstra kontrol olmaz.
    const fleeFrom=(x:number,z:number):[number,number]=>{
      const reach=Math.hypot(x,z)||1;
      for(const push of[6,4.5,3,1.5]){const scale=(reach+push)/reach,fx=x*scale,fz=z*scale;
        if(Math.hypot(fx,fz)<=villageReach+2&&walkable(fx,fz,.4))return[fx,fz]}
      return[x,z];
    };
    const villagerCount=homes.length?Math.max(3,Math.min(44,Math.round(homes.length*.8))):0;
    const villagers=Array.from({length:villagerCount},(unused,i)=>{
      const route=routes.length?i%routes.length:-1,home=homes.length?i%homes.length:-1;
      const lateral=(walkRandom()-.5)*2.1;
      const escape:[number,number]=route>=0
        ?[routes[route].cos*routes[route].outer-routes[route].sin*lateral*1.8,routes[route].sin*routes[route].outer+routes[route].cos*lateral*1.8]
        :home>=0?fleeFrom(homes[home].x,homes[home].z):[0,0];
      return {route,home,lateral,phase:walkRandom(),pace:.75+walkRandom()*.55,blend:0,
        ox:(walkRandom()-.5)*3.6,oz:(walkRandom()-.5)*3.6,fx:escape[0],fz:escape[1]};
    });
    let villagerMesh:THREE.InstancedMesh|null=null;
    if(villagerCount){
      villagerMesh=new THREE.InstancedMesh(geom("villager",()=>new THREE.CapsuleGeometry(.21,.53,4,7)),tinted(0xffffff),villagerCount);
      const tones=[0xbaa480,0xa89070,0xccb996,0x8f7b5d,0xa66d43,0x9c8fa0];
      for(let i=0;i<villagerCount;i++)villagerMesh.setColorAt(i,new THREE.Color(tones[i%tones.length]));
      if(villagerMesh.instanceColor)villagerMesh.instanceColor.needsUpdate=true;
      // Matrisler her karede değişiyor; sınır küresi güncellenmediği için kırpma
      // kapatılmazsa figürler bir anda yok oluyor.
      villagerMesh.frustumCulled=false;villagerMesh.castShadow=true;figures.add(villagerMesh);
    }

    // Devriye hattı: sur varsa surun hemen dışındaki KARE, yoksa çekirdek çevresi.
    const wallRing=9.4,patrolSquare=hasWall,patrolRadius=hasWall?wallRing+1.3:coreRadius+2.4;
    const patrolAt=(t:number):[number,number]=>{
      if(!patrolSquare){const a=t/4*Math.PI*2;return[Math.cos(a)*patrolRadius,Math.sin(a)*patrolRadius]}
      const R=patrolRadius,side=Math.floor(t)%4,u=(t-Math.floor(t))*2-1;
      if(side===0)return[R,u*R];if(side===1)return[-u*R,R];if(side===2)return[-R,-u*R];return[u*R,-R];
    };
    // Nöbette olmayan asker kışlanın çevresinde bekler; kışla yoksa kale önünde.
    // Kışlanın TAM konumu binanın içi; oraya konan asker gövdenin arkasında
    // kayboluyordu. Bekleme yeri kışlanın kale tarafındaki önüne alınır.
    const barracks=placed.find(item=>item.type==="barracks");
    const post=(()=>{
      if(!barracks)return{x:Math.cos(slotPhase)*(coreRadius+2.8),z:Math.sin(slotPhase)*(coreRadius+2.8)};
      const reach=Math.hypot(barracks.x,barracks.z)||1,front=Math.max(coreRadius+1.6,reach-4.4);
      return{x:barracks.x/reach*front,z:barracks.z/reach*front};
    })();
    const soldiers=Array.from({length:soldierCount},(unused,i)=>({
      t:(i/Math.max(1,soldierCount))*4,
      pace:.85+walkRandom()*.3,
      blend:0,
      ox:(walkRandom()-.5)*3.2,oz:(walkRandom()-.5)*3.2,
    }));
    let soldierMesh:THREE.InstancedMesh|null=null;
    if(soldierCount){
      soldierMesh=new THREE.InstancedMesh(geom("soldier",()=>new THREE.CapsuleGeometry(.23,.63,4,7)),tinted(0xffffff),soldierCount);
      const tones=[0x8d2f33,0x616b78,0x7a2529,0x4f5866];
      for(let i=0;i<soldierCount;i++)soldierMesh.setColorAt(i,new THREE.Color(tones[i%tones.length]));
      if(soldierMesh.instanceColor)soldierMesh.instanceColor.needsUpdate=true;
      soldierMesh.frustumCulled=false;soldierMesh.castShadow=true;figures.add(soldierMesh);
    }

    /** Figürleri ilerletir. Ruh hâli ve nöbet oranı her karede ref'ten okunur. */
    const stepWalkers=(dt:number)=>{
      if(villagerMesh){
        const state=moodRef.current;
        // Ruh hâli hızı VE hedefi belirler: memnun halk gezer, kaynayan halk
        // ağırlaşır, iş bırakan halk meydanda öbeklenir, isyan eden dışa kaçar.
        const pace=state==="uneasy"?.8:state==="simmering"?.42:state==="strike"?.06:state==="revolt"?1.35:1;
        const gathering=state==="strike",fleeing=state==="revolt";
        for(let i=0;i<villagers.length;i++){
          const walker=villagers[i];
          walker.phase=(walker.phase+dt*walker.pace*pace*.04)%1;
          const trip=walker.phase<.5?walker.phase*2:2-walker.phase*2;
          let x:number,z:number,facing:number;
          if(walker.route>=0){
            const route=routes[walker.route],d=route.inner+trip*(route.outer-route.inner);
            x=route.cos*d-route.sin*walker.lateral;z=route.sin*d+route.cos*walker.lateral;
            facing=-route.angle+(walker.phase<.5?Math.PI/2:-Math.PI/2);
          }else if(walker.home>=0){
            const home=homes[walker.home],a=walker.phase*Math.PI*2;
            x=home.x+Math.cos(a)*1.9;z=home.z+Math.sin(a)*1.9;facing=-a;
          }else continue;
          let tx=x,tz=z,pull=0;
          if(gathering){tx=rally.x+walker.ox;tz=rally.z+walker.oz;pull=1}
          else if(fleeing){tx=walker.fx;tz=walker.fz;pull=1}
          walker.blend+=(pull-walker.blend)*Math.min(1,dt*.7);
          dummy.position.set(x+(tx-x)*walker.blend,VILLAGER_Y,z+(tz-z)*walker.blend);
          dummy.rotation.set(0,facing,0);dummy.scale.setScalar(1);dummy.updateMatrix();
          villagerMesh.setMatrixAt(i,dummy.matrix);
        }
        villagerMesh.instanceMatrix.needsUpdate=true;
      }
      if(soldierMesh){
        // Nöbet oranı DOĞRUDAN okunur: askerlerin yüzde kaçı hatta, o kadarı
        // devriyede. %0'da hepsi kışlada, %100'de hepsi sur hattında.
        const watch=Math.max(0,Math.min(100,watchRef.current)),onDuty=soldiers.length*watch/100;
        for(let i=0;i<soldiers.length;i++){
          const guard=soldiers[i];
          guard.t=(guard.t+dt*guard.pace*.05)%4;
          guard.blend+=((i<onDuty?1:0)-guard.blend)*Math.min(1,dt*.55);
          const [px,pz]=patrolAt(guard.t),[nx,nz]=patrolAt((guard.t+.03)%4);
          const ix=post.x+guard.ox,iz=post.z+guard.oz;
          dummy.position.set(ix+(px-ix)*guard.blend,SOLDIER_Y,iz+(pz-iz)*guard.blend);
          dummy.rotation.set(0,Math.atan2(nx-px,nz-pz),0);dummy.scale.setScalar(1);dummy.updateMatrix();
          soldierMesh.setMatrixAt(i,dummy.matrix);
        }
        soldierMesh.instanceMatrix.needsUpdate=true;
      }
    };
    stepWalkers(0);

    const constructionCrane=new THREE.Group();
    if(constructionName){const site=new THREE.Group(),atKeep=constructionName.startsWith("Kale");site.position.set(atKeep?0:16,0,atKeep?0:-4);scene.add(site);const scaffold=0xb8894f;for(const x of[-2.2,2.2])for(const z of[-2.2,2.2])box(.16,4.8,.16,scaffold,x,2.4,z,site);for(const y of[1.2,2.5,3.8]){box(4.6,.12,.16,scaffold,0,y,-2.2,site);box(4.6,.12,.16,scaffold,0,y,2.2,site);box(.16,.12,4.6,scaffold,-2.2,y,0,site);box(.16,.12,4.6,scaffold,2.2,y,0,site)}box(3.7,.8,3.7,0x8c755d,0,.4,0,site);constructionCrane.position.set(2.8,0,-2.8);site.add(constructionCrane);box(.22,6,.22,0x6f4b2d,0,3,0,constructionCrane);box(5,.18,.18,0x6f4b2d,1.8,5.7,0,constructionCrane);box(.05,2,.05,0x2d231c,3.8,4.7,0,constructionCrane);}

    const line=(from:[number,number],to:[number,number],color:number)=>{const geo=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(from[0],.12,from[1]),new THREE.Vector3(to[0],.12,to[1])]);const material=new THREE.LineDashedMaterial({color,dashSize:1.5,gapSize:.8,transparent:true,opacity:.8});materials.set(`l${color}`,material);const drawn=new THREE.Line(geo,material);drawn.computeLineDistances();scene.add(drawn);return drawn;};
    const regionColors:Record<string,number>={plain:0x8b8b55,forest:0x355c38,mountain:0x696b61,riverbank:0x49706a};
    kingdoms.slice(0,40).forEach(kingdom=>{const {x,z}=kingdom.position,region=add(geom("region",()=>new THREE.CircleGeometry(7.5,28)),mat(regionColors[kingdom.terrain]??0x68784b),x,-.02,z);region.rotation.x=-Math.PI/2;region.castShadow=false;cylinder(1.15,2.8,kingdom.discovered?0x7a2529:0x493e35,x,1.4,z);cone(1.5,1.5,kingdom.discovered?0xb08a46:0x6a6257,x,3.55,z);box(1.7,1,1.4,0x927653,x+1.8,.5,z+1.5);});
    if(sharedMine){const {x,z}=sharedMine.position;const mineRegion=add(geom("mineRegion",()=>new THREE.CircleGeometry(8,28)),mat(0x8d6f3f),x,-.01,z);mineRegion.rotation.x=-Math.PI/2;mineRegion.castShadow=false;for(const offset of[-2,0,2])cone(1.8,3.5,0x54534d,x+offset,1.75,z+(offset%4));box(4.8,2,2.4,0x57402e,x,1,z+4);}
    const network=[...kingdoms.slice(0,40).map(kingdom=>line([0,0],[kingdom.position.x,kingdom.position.z],kingdom.discovered?0xd6a53f:0x8d7e61)),...(sharedMine?[line([0,0],[sharedMine.position.x,sharedMine.position.z],0xc59a43)]:[])];

    const labels:Array<{el:HTMLSpanElement;pos:THREE.Vector3;wide:boolean}>=[];
    const label=(text:string,x:number,y:number,z:number,wide=false)=>{const el=document.createElement("span");el.className="world-label";el.textContent=text;host.appendChild(el);labels.push({el,pos:new THREE.Vector3(x,y,z),wide});};
    label(`${keepLevel===1?"AHŞAP KALE":"KALE"} · SV.${keepLevel}`,0,keepLevel===1?5.5:9,0);
    if(constructionName)label(`⚒ İNŞAAT · ${constructionName}`,constructionName.startsWith("Kale")?0:16,7,constructionName.startsWith("Kale")?0:-4);
    // Her yapı kendi adını ve seviyesini taşır; oyuncu "7 yapım var" dediğinde 7 etiket görür.
    placed.forEach(item=>label(`${(buildingNames.get(item.type)??item.type).toLocaleUpperCase("tr")} · SV.${item.level}`,item.x,item.type==="wall"?4.5:5.2,item.z));
    // Etiket mahallenin AĞIRLIK MERKEZİNE otursun; sabit nokta evleri ıskalıyordu.
    if(homes.length)label(`⌂ MAHALLE · ${homes.length} HANE`,homes.reduce((sum,home)=>sum+home.x,0)/homes.length,3.4,homes.reduce((sum,home)=>sum+home.z,0)/homes.length);
    kingdoms.slice(0,40).forEach(kingdom=>label(kingdom.name??"BİLİNMEYEN SANCAK",kingdom.position.x,5,kingdom.position.z,true));
    if(sharedMine)label(`⛏ ${sharedMine.name} · ${sharedMine.totalWorkers} İŞÇİ`,sharedMine.position.x,5,sharedMine.position.z,true);
    terrainLabels.forEach(([text,x,y,z])=>label(text,x,y,z,true));

    const update=()=>{camera.position.set(Math.sin(theta)*46,35,Math.cos(theta)*46);camera.lookAt(0,1,0);camera.zoom=zoom;camera.updateProjectionMatrix();};update();let dragging=false,lastX=0,raf=0;
    const down=(e:PointerEvent)=>{dragging=true;lastX=e.clientX;},up=()=>{dragging=false;},move=(e:PointerEvent)=>{if(!dragging)return;theta-=(e.clientX-lastX)*.006;lastX=e.clientX;update();},wheel=(e:WheelEvent)=>{e.preventDefault();zoom=THREE.MathUtils.clamp(zoom-e.deltaY*.0015,.12,2.1);update();};renderer.domElement.addEventListener("pointerdown",down);window.addEventListener("pointerup",up);window.addEventListener("pointermove",move);renderer.domElement.addEventListener("wheel",wheel,{passive:false});
    const resize=()=>{const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h);const a=w/Math.max(h,1);/* Dikey gorus sabit kalirsa genis ekranda yatay 130+ birime aciliyor ve krallik bos zeminin icinde kayboluyor. Orani bozmadan tek care yakinlasmak. */const half=Math.max(13,Math.min(22,22/Math.max(1,a/1.6)));camera.left=-half*a;camera.right=half*a;camera.top=half;camera.bottom=-half;camera.updateProjectionMatrix();};const observer=new ResizeObserver(resize);observer.observe(host);resize();const clock=new THREE.Clock();
    // Uzaklaşınca yalnızca insanlar silinir; şehrin kendisi çok uzakta bile
    // durur. Eskiden binalar da figürlerle aynı gruptaydı ve Kral biraz
    // uzaklaşınca kale dışında hiçbir şey kalmıyordu.
    const animate=()=>{raf=requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.05);const time=clock.elapsedTime;if(!dragging&&autoRotateRef.current){theta+=dt*.1;update();}
      spinners.forEach(blades=>{blades.rotation.z+=dt*.9});
      if(figures.visible)stepWalkers(dt); // Uzaklaşınca figürler gizli; matris yazmaya da gerek yok.
      water.forEach(({mesh,base})=>{(mesh.material as THREE.MeshStandardMaterial).opacity=base+Math.sin(time*.7)*.06});
      if(constructionName)constructionCrane.rotation.y+=dt*.12;
      const dark=nightRef.current;ambient.intensity+=((dark ? .5 : 1.8)-ambient.intensity)*.04;sun.intensity+=((dark ? .25 : 2.6)-sun.intensity)*.04;scene.fog!.color.lerp(new THREE.Color(dark?0x101b2d:plan.fog),.04);
      figures.visible=zoom>.48;detail.visible=zoom>.16;network.forEach(l=>l.visible=zoom<.78);labels.forEach(({el,pos,wide})=>{const p=pos.clone().project(camera);el.style.left=`${(p.x*.5+.5)*host.clientWidth}px`;el.style.top=`${(-p.y*.5+.5)*host.clientHeight}px`;el.classList.toggle("visible",wide?zoom<.78:zoom>.43);});renderer.render(scene,camera);};animate();
    return()=>{
      cancelAnimationFrame(raf);observer.disconnect();
      renderer.domElement.removeEventListener("pointerdown",down);window.removeEventListener("pointerup",up);window.removeEventListener("pointermove",move);renderer.domElement.removeEventListener("wheel",wheel);
      labels.forEach(({el})=>el.remove());
      // Havuzlar tek elden temizlenir; havuza girmeyen bir şey kalırsa diye sahne
      // ayrıca taranır. Aksi hâlde her sekme değişiminde GPU tamponu birikiyor.
      scene.traverse(node=>{const target=node as THREE.Object3D&{geometry?:THREE.BufferGeometry;material?:THREE.Material|THREE.Material[]};target.geometry?.dispose();const material=target.material;if(Array.isArray(material))material.forEach(entry=>entry.dispose());else material?.dispose();
        // InstancedMesh ayrıca örnek tamponlarını (matrix/color) tutar; sahne
        // taraması yalnız geometri ve materyali kapsıyordu.
        const instanced=node as THREE.InstancedMesh;if(instanced.isInstancedMesh)instanced.dispose()});
      geometries.forEach(entry=>entry.dispose());materials.forEach(entry=>entry.dispose());
      geometries.clear();materials.clear();
      renderer.dispose();host.removeChild(renderer.domElement);
    };
    // `kingdoms`, `sharedMine` ve `buildings` bilerek listede yok: dünya verisi 10
    // saniyede bir YENİ nesne olarak geliyor, referansa bağlansaydı sahne sürekli
    // baştan kurulurdu. Yerlerine içerikten türeyen imzalar bağlanır.
    // `mood` ve `watchRatio` da yok: onlar ref'ten canlı okunur, çünkü her tick'te
    // değişebilirler ve sahneyi yeniden kurmaları kabul edilemez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[keepLevel,developed,terrain,constructionName,worldSignature,buildingSignature,houseCount,crowdBand,soldierCount,seedKey]);
  return <div className="three-host" ref={mount} aria-label="Etkileşimli izometrik Demirkale dünya haritası"/>;
}
