import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LDrawLoader } from 'three/addons/loaders/LDrawLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0f0f0);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(150, 150, 150);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setAnimationLoop(animate);
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.update();

// Lights
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.2);
hemiLight.position.set(0, 200, 0);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(100, 200, 100).normalize();
scene.add(dirLight);

let partGroup = null;
let uvMapDataURL = "";

// Load LEGO part
const loader = new LDrawLoader();
loader.setPartsLibraryPath('./LDraw/');
loader.load('./LDraw/parts/3001.dat', function(group) {
    console.log("LEGO part loaded successfully");
    group.rotation.x = Math.PI;

    const geometries = [];
    group.traverse(child => {
        if (child.isMesh) {
            child.updateMatrix();
            geometries.push(child.geometry.clone().applyMatrix4(child.matrix));
        }
    });

    const mergedGeometry = mergeGeometries(geometries, true);
    const mergedMesh = new THREE.Mesh(
        mergedGeometry,
        new THREE.MeshStandardMaterial({
            color: 0xffffff,
            opacity: 0.5,      // half transparent
            transparent: true,  // enable transparency
            // side: THREE.DoubleSide
        })
    );

    mergedMesh.rotation.x = Math.PI;

    partGroup = mergedMesh;
    scene.add(mergedMesh);

    // mark exterior faces
    //markExteriorFaces(mergedMesh);
    assignUVsAndGenerateTemplate(mergedMesh);
}, undefined, function(error) {
    console.error('Error loading part:', error);
});

function assignUVsAndGenerateTemplate(mesh, scale = 50) {
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    const L = box.max.x - box.min.x; // length (X)
    const H = box.max.y - box.min.y; // height (Y)
    const W = box.max.z - box.min.z; // width (Z)

    const texW = 2 * (L + W);
    const texH = 2 * W + H;

    const pos = mesh.geometry.attributes.position;
    const uv = new Float32Array(pos.count * 2);

    const regions = {
        top:    { x: W,       y: 0,     w: L, h: W },
        left:   { x: 0,       y: W,     w: W, h: H },
        front:  { x: W,       y: W,     w: L, h: H },
        right:  { x: W + L,   y: W,     w: W, h: H },
        back:   { x: W + L + W, y: W,   w: L, h: H },
        bottom: { x: W,       y: W + H, w: L, h: W }
    };

    const mappers = {
        top:    v => new THREE.Vector2(regions.top.x + (v.x - box.min.x), regions.top.y + (W - (v.z - box.min.z))),
        bottom: v => new THREE.Vector2(regions.bottom.x + (v.x - box.min.x), regions.bottom.y + (v.z - box.min.z)),
        front:  v => new THREE.Vector2(regions.front.x + (v.x - box.min.x), regions.front.y + (H - (v.y - box.min.y))),
        back:   v => new THREE.Vector2(regions.back.x + (L - (v.x - box.min.x)), regions.back.y + (H - (v.y - box.min.y))),
        left:   v => new THREE.Vector2(regions.left.x + (v.z - box.min.z), regions.left.y + (H - (v.y - box.min.y))),
        right:  v => new THREE.Vector2(regions.right.x + (W - (v.z - box.min.z)), regions.right.y + (H - (v.y - box.min.y)))
    };

    const referencePoints = {
        top:    v => new THREE.Vector3(v.x, box.max.y + 1, v.z),
        bottom: v => new THREE.Vector3(v.x, box.min.y - 1, v.z),
        front:  v => new THREE.Vector3(v.x, v.y, box.min.z - 1),
        back:   v => new THREE.Vector3(v.x, v.y, box.max.z + 1),
        left:   v => new THREE.Vector3(box.min.x - 1, v.y, v.z),
        right:  v => new THREE.Vector3(box.max.x + 1, v.y, v.z)
    };

    const raycaster = new THREE.Raycaster();

    for (let i = 0; i < pos.count; i += 3) {
        const v0 = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
        const v1 = new THREE.Vector3(pos.getX(i + 1), pos.getY(i + 1), pos.getZ(i + 1));
        const v2 = new THREE.Vector3(pos.getX(i + 2), pos.getY(i + 2), pos.getZ(i + 2));

        const normal = new THREE.Vector3().crossVectors(
            new THREE.Vector3().subVectors(v1, v0),
            new THREE.Vector3().subVectors(v2, v0)
        ).normalize();

        let mapper, view;
        if (Math.abs(normal.y) > Math.abs(normal.x) && Math.abs(normal.y) > Math.abs(normal.z)) {
            mapper = normal.y > 0 ? mappers.top : mappers.bottom;
            view = normal.y > 0 ? "top" : "bottom";
        } else if (Math.abs(normal.z) > Math.abs(normal.x)) {
            mapper = normal.z > 0 ? mappers.back : mappers.front;
            view = normal.z > 0 ? "back" : "front";
        } else {
            mapper = normal.x > 0 ? mappers.right : mappers.left;
            view = normal.x > 0 ? "right" : "left";
        }

        // Raycast for each vertex to detect exterior
        const vertices = [v0, v1, v2];
        let isExterior = false;
        for (let v of vertices) {
            const refPoint = referencePoints[view](v);
            const dir = new THREE.Vector3().subVectors(v, refPoint).normalize();
            raycaster.set(refPoint, dir);
            const intersects = raycaster.intersectObject(mesh, true);
            if (intersects.length &&
                Math.abs(intersects[0].point.distanceTo(refPoint) - v.distanceTo(refPoint)) < 0.001) {
                isExterior = true;
                break;
            }
        }

        if (!isExterior) {
            uv.set([0, 0, 0, 0, 0, 0], i * 2);
            continue;
        }

        vertices.forEach((v, j) => {
            const uvCoords = mapper(v);
            const idx = i + j;
            uv[idx * 2] = uvCoords.x / texW;
            uv[idx * 2 + 1] = 1 - uvCoords.y / texH;
        });
    }

    mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

    const canvas = document.createElement("canvas");
    canvas.width = texW * scale;
    canvas.height = texH * scale;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "#00AAFF";
    ctx.lineWidth = 1;

    for (let i = 0; i < pos.count; i += 3) {
        const uv0 = new THREE.Vector2(uv[i * 2] * texW, uv[i * 2 + 1] * texH);
        const uv1 = new THREE.Vector2(uv[(i + 1) * 2] * texW, uv[(i + 1) * 2 + 1] * texH);
        const uv2 = new THREE.Vector2(uv[(i + 2) * 2] * texW, uv[(i + 2) * 2 + 1] * texH);

        if (uv0.equals(new THREE.Vector2(0, 0)) &&
            uv1.equals(new THREE.Vector2(0, 0)) &&
            uv2.equals(new THREE.Vector2(0, 0))) continue;

        ctx.beginPath();
        ctx.moveTo(uv0.x * scale, uv0.y * scale);
        ctx.lineTo(uv1.x * scale, uv1.y * scale);
        ctx.lineTo(uv2.x * scale, uv2.y * scale);
        ctx.closePath();
        ctx.stroke();
    }

    uvMapDataURL = canvas.toDataURL("image/png");
}

function animate() {
    controls.update();
    renderer.render(scene, camera);
}

window.addEventListener("resize", () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

document.getElementById('textureInput').addEventListener('change', function(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function(e) {
        const textureLoader = new THREE.TextureLoader();
        const texture = textureLoader.load(e.target.result, tex => {
            tex.flipY = false; // important — your UVs already flip Y
            tex.minFilter = THREE.NearestFilter; // optional: prevents blur if you want crisp LEGO texture
            tex.generateMipmaps = false; // optional: for exact alignment
        });

        if (partGroup && partGroup.isMesh) {
            partGroup.material = new THREE.MeshStandardMaterial({
                map: texture,
                color: 0xffffff
            });
            partGroup.material.needsUpdate = true;
        }
    };
    reader.readAsDataURL(file);
});

// Hook up download button
document.getElementById('downloadUV').addEventListener('click', () => {
    const link = document.createElement('a');
    link.href = uvMapDataURL;
    link.download = 'uvmap.png';
    link.click();
});
