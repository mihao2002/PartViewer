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
    // group.rotation.x = Math.PI;

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

    // mergedMesh.rotation.x = Math.PI;

    partGroup = mergedMesh;
    scene.add(mergedMesh);

    // mark exterior faces
    //markExteriorFaces(mergedMesh);
    assignUVsAndGenerateTemplate(mergedMesh);

    // create toggle button
    const markBtn = document.createElement("button");
    markBtn.textContent = "Toggle Exterior Mark";
    document.body.appendChild(markBtn);

    let marked = false;
    markBtn.addEventListener("click", () => {
        if (!marked) {
            mergedMesh.material = createExteriorMarkMaterial();
        } else {
            mergedMesh.material = new THREE.MeshStandardMaterial({ color: 0xffffff });
        }
        marked = !marked;
    });
}, undefined, function(error) {
    console.error('Error loading part:', error);
});

function assignUVsAndGenerateTemplate(mesh, scale = 50) {
    mesh.geometry.computeBoundingBox();
    const box = mesh.geometry.boundingBox;
    const L = box.max.x - box.min.x; // length (X)
    const H = box.max.y - box.min.y; // height (Y)
    const W = box.max.z - box.min.z; // width (Z)

    // Texture dimensions
    const texW = 2 * (L + W);
    const texH = 2 * W + H;

    const pos = mesh.geometry.attributes.position;
    const uv = new Float32Array(pos.count * 2);

    const setFaceUV = (i0, i1, i2, mapper) => {
        const v0 = new THREE.Vector3(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
        const v1 = new THREE.Vector3(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
        const v2 = new THREE.Vector3(pos.getX(i2), pos.getY(i2), pos.getZ(i2));

        [v0, v1, v2].forEach((v, j) => {
            const uvCoords = mapper(v);
            uv[(i0 + j) * 2] = uvCoords.x / texW;
            uv[(i0 + j) * 2 + 1] = uvCoords.y / texH;
        });
    };

    // Precompute rectangle bounds
    const regions = {
        top:    { x: W,       y: 0,     w: L, h: W },
        left:   { x: 0,       y: W,     w: W, h: H },
        front:  { x: W,       y: W,     w: L, h: H },
        right:  { x: W + L,   y: W,     w: W, h: H },
        back:   { x: W + L + W, y: W,   w: L, h: H },
        bottom: { x: W,       y: W + H, w: L, h: W }
    };

    // Mappers for each view
    const mappers = {
        top:    v => new THREE.Vector2(regions.top.x + (v.x - box.min.x), regions.top.y + (W - (v.z - box.min.z))),
        bottom: v => new THREE.Vector2(regions.bottom.x + (v.x - box.min.x), regions.bottom.y + (v.z - box.min.z)),
        front:  v => new THREE.Vector2(regions.front.x + (v.x - box.min.x), regions.front.y + (H - (v.y - box.min.y))),
        back:   v => new THREE.Vector2(regions.back.x + (L - (v.x - box.min.x)), regions.back.y + (H - (v.y - box.min.y))),
        left:   v => new THREE.Vector2(regions.left.x + (v.z - box.min.z), regions.left.y + (H - (v.y - box.min.y))),
        right:  v => new THREE.Vector2(regions.right.x + (W - (v.z - box.min.z)), regions.right.y + (H - (v.y - box.min.y)))
    };

    // Loop faces
    for (let i = 0; i < pos.count; i += 3) {
        const v0 = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
        const v1 = new THREE.Vector3(pos.getX(i+1), pos.getY(i+1), pos.getZ(i+1));
        const v2 = new THREE.Vector3(pos.getX(i+2), pos.getY(i+2), pos.getZ(i+2));

        const centroid = new THREE.Vector3().addVectors(v0, v1).add(v2).divideScalar(3);

        // Choose projection by dominant axis of normal
        const normal = new THREE.Vector3().crossVectors(
            new THREE.Vector3().subVectors(v1, v0),
            new THREE.Vector3().subVectors(v2, v0)
        ).normalize();

        let mapper;
        if (Math.abs(normal.y) > Math.abs(normal.x) && Math.abs(normal.y) > Math.abs(normal.z)) {
            mapper = normal.y > 0 ? mappers.top : mappers.bottom;
        } else if (Math.abs(normal.z) > Math.abs(normal.x)) {
            mapper = normal.z > 0 ? mappers.back : mappers.front;
        } else {
            mapper = normal.x > 0 ? mappers.right : mappers.left;
        }

        [v0, v1, v2].forEach((v, j) => {
            const uvCoords = mapper(v);
            const idx = i + j;
            uv[idx * 2]     = uvCoords.x / texW;
            uv[idx * 2 + 1] = 1 - uvCoords.y / texH; // flip Y for texture space
        });
    }

    mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));

    // === Reference Template Image ===
    const canvas = document.createElement("canvas");
    canvas.width = texW * scale;
    canvas.height = texH * scale;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;

    // Object.entries(regions).forEach(([name, r]) => {
    //     ctx.strokeRect(r.x * scale, r.y * scale, r.w * scale, r.h * scale);
    //     ctx.fillStyle = "black";
    //     ctx.font = `${16}px Arial`;
    //     ctx.fillText(name, (r.x + 0.2) * scale, (r.y + 0.5) * scale);
    // });

    // === Draw projected faces onto template ===
    ctx.strokeStyle = "#00AAFF"; // light blue for triangles
    ctx.lineWidth = 1;

    for (let i = 0; i < pos.count; i += 3) {
        const uv0 = new THREE.Vector2(uv[i * 2] * texW, uv[i * 2 + 1] * texH);
        const uv1 = new THREE.Vector2(uv[(i + 1) * 2] * texW, uv[(i + 1) * 2 + 1] * texH);
        const uv2 = new THREE.Vector2(uv[(i + 2) * 2] * texW, uv[(i + 2) * 2 + 1] * texH);

        ctx.beginPath();
        ctx.moveTo(uv0.x * scale, uv0.y * scale);
        ctx.lineTo(uv1.x * scale, uv1.y * scale);
        ctx.lineTo(uv2.x * scale, uv2.y * scale);
        ctx.closePath();
        ctx.stroke();
    }

    uvMapDataURL = canvas.toDataURL("image/png");
}


function addReferencePointMarker(scene, point) {
    const sphereGeom = new THREE.SphereGeometry(2, 16, 16);
    const sphereMat = new THREE.MeshBasicMaterial({ color: 0x0000ff });
    const sphere = new THREE.Mesh(sphereGeom, sphereMat);
    sphere.position.copy(point);
    scene.add(sphere);
}

function createExteriorMarkMaterial() {
    return new THREE.ShaderMaterial({
        vertexShader: `
            attribute float exteriorFace;
            varying float vExterior;
            varying vec2 vUv;
            void main() {
                vUv = uv;
                vExterior = exteriorFace;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            varying float vExterior;
            varying vec2 vUv;
            void main() {
                if (vExterior > 0.5) {
                    gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); // red exterior
                } else {
                    gl_FragColor = vec4(0.8, 0.8, 0.8, 1.0); // grey interior
                }
            }
        `,
        side: THREE.DoubleSide
    });
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
