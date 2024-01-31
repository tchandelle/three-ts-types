import * as THREE from "three";

import Stats from "three/addons/libs/stats.module.js";
import { GUI } from "three/addons/libs/lil-gui.module.min.js";

import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { radixSort } from "three/addons/utils/SortUtils.js";

let stats, gui, guiStatsEl;
let camera, controls, scene, renderer;
let geometries, mesh, material;
const ids = [];
const matrix = new THREE.Matrix4();

//

const position = new THREE.Vector3();
const rotation = new THREE.Euler();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();

//

const MAX_GEOMETRY_COUNT = 20000;

const Method = {
    BATCHED: "BATCHED",
    NAIVE: "NAIVE",
};

const api = {
    method: Method.BATCHED,
    count: 256,
    dynamic: 16,

    sortObjects: true,
    perObjectFrustumCulled: true,
    opacity: 1,
    useCustomSort: true,
};

init();
initGeometries();
initMesh();
animate();

//

function randomizeMatrix(matrix) {
    position.x = Math.random() * 40 - 20;
    position.y = Math.random() * 40 - 20;
    position.z = Math.random() * 40 - 20;

    rotation.x = Math.random() * 2 * Math.PI;
    rotation.y = Math.random() * 2 * Math.PI;
    rotation.z = Math.random() * 2 * Math.PI;

    quaternion.setFromEuler(rotation);

    scale.x = scale.y = scale.z = 0.5 + (Math.random() * 0.5);

    return matrix.compose(position, quaternion, scale);
}

function randomizeRotationSpeed(rotation) {
    rotation.x = Math.random() * 0.01;
    rotation.y = Math.random() * 0.01;
    rotation.z = Math.random() * 0.01;
    return rotation;
}

function initGeometries() {
    geometries = [
        new THREE.ConeGeometry(1.0, 2.0),
        new THREE.BoxGeometry(2.0, 2.0, 2.0),
        new THREE.SphereGeometry(1.0, 16, 8),
    ];
}

function createMaterial() {
    if (!material) {
        material = new THREE.MeshNormalMaterial();
    }

    return material;
}

function cleanup() {
    if (mesh) {
        mesh.parent.remove(mesh);

        if (mesh.dispose) {
            mesh.dispose();
        }
    }
}

function initMesh() {
    cleanup();

    if (api.method === Method.BATCHED) {
        initBatchedMesh();
    } else {
        initRegularMesh();
    }
}

function initRegularMesh() {
    mesh = new THREE.Group();
    const material = createMaterial();

    for (let i = 0; i < api.count; i++) {
        const child = new THREE.Mesh(geometries[i % geometries.length], material);
        randomizeMatrix(child.matrix);
        child.matrix.decompose(child.position, child.quaternion, child.scale);
        child.userData.rotationSpeed = randomizeRotationSpeed(new THREE.Euler());
        mesh.add(child);
    }

    scene.add(mesh);
}

function initBatchedMesh() {
    const geometryCount = api.count;
    const vertexCount = api.count * 512;
    const indexCount = api.count * 1024;

    const euler = new THREE.Euler();
    const matrix = new THREE.Matrix4();
    mesh = new THREE.BatchedMesh(geometryCount, vertexCount, indexCount, createMaterial());
    mesh.userData.rotationSpeeds = [];

    // disable full-object frustum culling since all of the objects can be dynamic.
    mesh.frustumCulled = false;

    ids.length = 0;

    for (let i = 0; i < api.count; i++) {
        const id = mesh.addGeometry(geometries[i % geometries.length]);
        mesh.setMatrixAt(id, randomizeMatrix(matrix));

        const rotationMatrix = new THREE.Matrix4();
        rotationMatrix.makeRotationFromEuler(randomizeRotationSpeed(euler));
        mesh.userData.rotationSpeeds.push(rotationMatrix);

        ids.push(id);
    }

    scene.add(mesh);
}

function init() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    // camera

    camera = new THREE.PerspectiveCamera(70, width / height, 1, 100);
    camera.position.z = 30;

    // renderer

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height);
    document.body.appendChild(renderer.domElement);

    // scene

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff);

    // controls

    controls = new OrbitControls(camera, renderer.domElement);
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.0;

    // stats

    stats = new Stats();
    document.body.appendChild(stats.dom);

    // gui

    gui = new GUI();
    gui.add(api, "count", 1, MAX_GEOMETRY_COUNT).step(1).onChange(initMesh);
    gui.add(api, "dynamic", 0, MAX_GEOMETRY_COUNT).step(1);
    gui.add(api, "method", Method).onChange(initMesh);
    gui.add(api, "opacity", 0, 1).onChange((v) => {
        if (v < 1) {
            material.transparent = true;
            material.depthWrite = false;
        } else {
            material.transparent = false;
            material.depthWrite = true;
        }

        material.opacity = v;
        material.needsUpdate = true;
    });
    gui.add(api, "sortObjects");
    gui.add(api, "perObjectFrustumCulled");
    gui.add(api, "useCustomSort");

    guiStatsEl = document.createElement("li");
    guiStatsEl.classList.add("gui-stats");

    // listeners

    window.addEventListener("resize", onWindowResize);
}

//

function sortFunction(list, camera) {
    // initialize options
    this._options = this._options || {
        get: (el) => el.z,
        aux: new Array(this.maxGeometryCount),
    };

    const options = this._options;
    options.reversed = this.material.transparent;

    // convert depth to unsigned 32 bit range
    const factor = (2 ** 32 - 1) / camera.far; // UINT32_MAX / max_depth
    for (let i = 0, l = list.length; i < l; i++) {
        list[i].z *= factor;
    }

    // perform a fast-sort using the hybrid radix sort function
    radixSort(list, options);
}

function onWindowResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    renderer.setSize(width, height);
}

function animate() {
    requestAnimationFrame(animate);

    animateMeshes();

    controls.update();
    stats.update();

    render();
}

function animateMeshes() {
    const loopNum = Math.min(api.count, api.dynamic);

    if (api.method === Method.BATCHED) {
        for (let i = 0; i < loopNum; i++) {
            const rotationMatrix = mesh.userData.rotationSpeeds[i];
            const id = ids[i];

            mesh.getMatrixAt(id, matrix);
            matrix.multiply(rotationMatrix);
            mesh.setMatrixAt(id, matrix);
        }
    } else {
        for (let i = 0; i < loopNum; i++) {
            const child = mesh.children[i];
            const rotationSpeed = child.userData.rotationSpeed;

            child.rotation.set(
                child.rotation.x + rotationSpeed.x,
                child.rotation.y + rotationSpeed.y,
                child.rotation.z + rotationSpeed.z,
            );
        }
    }
}

function render() {
    if (mesh.isBatchedMesh) {
        mesh.sortObjects = api.sortObjects;
        mesh.perObjectFrustumCulled = api.perObjectFrustumCulled;
        mesh.setCustomSort(api.useCustomSort ? sortFunction : null);
    }

    renderer.render(scene, camera);
}
