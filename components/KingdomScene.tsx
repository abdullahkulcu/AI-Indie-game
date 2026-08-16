"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";
type Props = { night: boolean; keepLevel?: number; developed?: boolean };

export default function KingdomScene({ night, keepLevel = 1, developed = false }: Props) {
  const mount = useRef<HTMLDivElement>(null); const nightRef = useRef(night);
  useEffect(() => { nightRef.current = night; }, [night]);
  useEffect(() => {
    const host = mount.current; if (!host) return;
    const scene = new THREE.Scene(); scene.fog = new THREE.FogExp2(0xd8c8a6, .006);
    const camera = new THREE.OrthographicCamera(-26, 26, 22, -22, .1, 400); let theta = Math.PI / 4, zoom = 1;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; host.appendChild(renderer.domElement);
    const ambient = new THREE.HemisphereLight(0xffe3b8, 0x364425, 1.8); const sun = new THREE.DirectionalLight(0xffdca3, 2.6); sun.position.set(-25, 40, 20); sun.castShadow = true; scene.add(ambient, sun);
    const mat = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: .82 });
    const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = scene) => { const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x,y,z); mesh.castShadow=true; mesh.receiveShadow=true; parent.add(mesh); return mesh; };
    const box=(w:number,h:number,d:number,c:number,x:number,y:number,z:number,p?:THREE.Object3D)=>add(new THREE.BoxGeometry(w,h,d),mat(c),x,y,z,p);
    const cylinder=(r:number,h:number,c:number,x:number,y:number,z:number,p?:THREE.Object3D)=>add(new THREE.CylinderGeometry(r,r,h,12),mat(c),x,y,z,p);
    const cone=(r:number,h:number,c:number,x:number,y:number,z:number,p?:THREE.Object3D)=>add(new THREE.ConeGeometry(r,h,8),mat(c),x,y,z,p);
    const ground=add(new THREE.CircleGeometry(94,64),mat(0x4d6635),0,-.08,0); ground.rotation.x=-Math.PI/2; const moat=add(new THREE.RingGeometry(8.4,10,48),mat(0x315f70),0,0,0); moat.rotation.x=-Math.PI/2;
    const detail=new THREE.Group(), castle=new THREE.Group(); scene.add(detail,castle); castle.scale.setScalar(.72 + Math.min(6,keepLevel)*.07);
    cylinder(2.25,6.2,0x8b8374,0,3.1,0,castle); cone(2.8,2.5,0x641d26,0,7.45,0,castle);
    [[-5,-5],[5,-5],[-5,5],[5,5]].forEach(([x,z])=>{cylinder(1.15,4.6,0x777166,x,2.3,z,castle);cone(1.45,1.6,0x641d26,x,5.35,z,castle);});
    box(10.5,3.1,.65,0x6f6a61,0,1.55,-5,castle);box(10.5,3.1,.65,0x6f6a61,0,1.55,5,castle);box(.65,3.1,10.5,0x6f6a61,-5,1.55,0,castle);box(.65,3.1,10.5,0x6f6a61,5,1.55,0,castle);
    for(let i=-4.7;i<=4.7;i+=1.3){box(.55,.55,.55,0x5f5b54,i,3.35,-5,castle);box(.55,.55,.55,0x5f5b54,i,3.35,5,castle);}
    const building=(x:number,z:number,w=2.4,d=1.9,h=1.7,roof=0x70242b)=>{const g=new THREE.Group();g.position.set(x,0,z);detail.add(g);box(w,h,d,0x9a7c57,0,h/2,0,g);const r=cone(Math.max(w,d)*.72,1.4,roof,0,h+.7,0,g);r.rotation.y=Math.PI/4;};
    [[-11,-7],[10,-8],[-11,3],[11,6],[-7,10],[7,11],[13,-1],[-13,-1]].forEach(([x,z],i)=>building(x,z,i%2?2.7:2.2,2,1.5+i%3*.25,i%3===0?0x314f56:0x70242b));
    const mill=new THREE.Group();mill.position.set(11,0,1.5);detail.add(mill);cylinder(1.35,3.5,0xc2ad82,0,1.75,0,mill);cone(1.55,1.4,0x70242b,0,4.15,0,mill);const blades=new THREE.Group();blades.position.set(0,3.2,1.35);mill.add(blades);for(let i=0;i<4;i++){const arm=new THREE.Group();arm.rotation.z=i*Math.PI/2;box(.18,2.8,.08,0xe4d0a5,0,1.4,0,arm);blades.add(arm);}
    const tree=(x:number,z:number)=>{cylinder(.18,1,0x5f3e25,x,.5,z,detail);cone(.9,2,0x274b2e,x,1.75,z,detail);}; [[-16,-11],[-17,-7],[-15,10],[-12,14],[15,12],[17,8],[15,-12],[-8,-15],[-4,15]].forEach(([x,z])=>tree(x,z));
    const positions:Record<string,[number,number,number]>={"Kızılorman":[-38,-25,0x2d695e],"Karataş":[44,-7,0x7e2228],"Ejderbaşı":[-42,27,0x792329],"Yeşilvadi":[-58,-7,0x3a7664],"Gümüşkanat":[-20,48,0x3b716c],"Akbeyaz":[12,54,0x487b76],"Kurtboğan":[65,-15,0x7a2529],"Taşyürek":[-8,-52,0x7a2529]};
    Object.values(positions).forEach(([x,z,color])=>{cylinder(1.4,3,color,x,1.5,z);cone(1.8,1.7,color,x,3.85,z);box(2,1.2,1.5,0x987951,x+2,.6,z+2);});
    const line=(from:[number,number],to:[number,number],color:number)=>{const geo=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(from[0],.12,from[1]),new THREE.Vector3(to[0],.12,to[1])]);const l=new THREE.Line(geo,new THREE.LineDashedMaterial({color,dashSize:1.5,gapSize:.8,transparent:true,opacity:.8}));l.computeLineDistances();scene.add(l);return l;};
    const network=[line([0,0],[-38,-25],0xd6a53f),line([0,0],[12,54],0xd6a53f),line([0,0],[44,-7],0x9f3c42),line([0,0],[-42,27],0x9f3c42),line([-58,-7],[-8,-52],0x9f3c42)];
    const river=add(new THREE.PlaneGeometry(6,80),mat(0x315f70),-25,.01,-7);river.rotation.x=-Math.PI/2;river.rotation.z=.13;[[34,18],[40,21],[38,28],[45,15]].forEach(([x,z],i)=>cone(3.5+i%2,6+i,0x66645f,x,(6+i)/2,z));for(let i=0;i<22;i++)tree(-33+(i%5)*2,-2+Math.floor(i/5)*2.4);const desert=add(new THREE.CircleGeometry(15,32),mat(0xb7965e),42,.02,28);desert.rotation.x=-Math.PI/2;
    const labels:Array<{el:HTMLSpanElement;pos:THREE.Vector3;wide:boolean}>=[];const label=(text:string,x:number,y:number,z:number,wide=false)=>{const el=document.createElement("span");el.className="world-label";el.textContent=text;host.appendChild(el);labels.push({el,pos:new THREE.Vector3(x,y,z),wide});};label(`KALE · SV.${keepLevel}`,0,9,0);if(developed){label("SUR · KİLİTLİ",5,4,-5);label("AMBAR",7,4,11)}Object.entries(positions).forEach(([name,[x,z]])=>label(name,x,5,z,true));label("DAĞ SİLSİLESİ",39,9,21,true);label("BÜYÜK NEHİR",-25,3,-10,true);label("YEŞİL ORMAN",-31,4,5,true);label("KIRAÇ OVA",42,3,28,true);
    const update=()=>{camera.position.set(Math.sin(theta)*46,35,Math.cos(theta)*46);camera.lookAt(0,1,0);camera.zoom=zoom;camera.updateProjectionMatrix();};update();let dragging=false,lastX=0,raf=0;
    const down=(e:PointerEvent)=>{dragging=true;lastX=e.clientX;},up=()=>{dragging=false;},move=(e:PointerEvent)=>{if(!dragging)return;theta-=(e.clientX-lastX)*.006;lastX=e.clientX;update();},wheel=(e:WheelEvent)=>{e.preventDefault();zoom=THREE.MathUtils.clamp(zoom-e.deltaY*.0015,.28,2.1);update();};renderer.domElement.addEventListener("pointerdown",down);window.addEventListener("pointerup",up);window.addEventListener("pointermove",move);renderer.domElement.addEventListener("wheel",wheel,{passive:false});
    const resize=()=>{const w=host.clientWidth,h=host.clientHeight;renderer.setSize(w,h);const a=w/Math.max(h,1);camera.left=-22*a;camera.right=22*a;camera.top=22;camera.bottom=-22;camera.updateProjectionMatrix();};const observer=new ResizeObserver(resize);observer.observe(host);resize();const clock=new THREE.Clock();
    const animate=()=>{raf=requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.05);if(!dragging){theta+=dt*.025;update();}blades.rotation.z+=dt*.9;const dark=nightRef.current;ambient.intensity+=((dark ? .5 : 1.8)-ambient.intensity)*.04;sun.intensity+=((dark ? .25 : 2.6)-sun.intensity)*.04;scene.fog!.color.lerp(new THREE.Color(dark?0x101b2d:0xd8c8a6),.04);detail.visible=zoom>.48;network.forEach(l=>l.visible=zoom<.78);labels.forEach(({el,pos,wide})=>{const p=pos.clone().project(camera);el.style.left=`${(p.x*.5+.5)*host.clientWidth}px`;el.style.top=`${(-p.y*.5+.5)*host.clientHeight}px`;el.classList.toggle("visible",wide?zoom<.78:zoom>.43);});renderer.render(scene,camera);};animate();
    return()=>{cancelAnimationFrame(raf);observer.disconnect();renderer.domElement.removeEventListener("pointerdown",down);window.removeEventListener("pointerup",up);window.removeEventListener("pointermove",move);renderer.domElement.removeEventListener("wheel",wheel);labels.forEach(({el})=>el.remove());renderer.dispose();host.removeChild(renderer.domElement);};
  },[keepLevel,developed]);
  return <div className="three-host" ref={mount} aria-label="Etkileşimli izometrik Demirkale dünya haritası"/>;
}
