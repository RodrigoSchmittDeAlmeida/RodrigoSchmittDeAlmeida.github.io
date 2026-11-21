import './style.css';
import { PORTFOLIO_PROJECTS } from './data/projectsData';
import { SceneManager } from './engine/SceneManager';
import { HudController } from './ui/HudController';

function bootstrap(): void {
  const viewportHost = document.getElementById('viewport-canvas-host');
  const hudRoot = document.getElementById('hud-root');

  if (!viewportHost || !hudRoot) {
    throw new Error('Elementos raiz #viewport-canvas-host ou #hud-root não encontrados no DOM.');
  }

  let hud: HudController | null = null;
  let autoAudioAttempted = false;

  const sceneManager = new SceneManager(viewportHost, PORTFOLIO_PROJECTS, {
    onTelemetry: (telemetry) => {
      hud?.updateTelemetry(telemetry);
    },
    onSelectProject: (project) => {
      hud?.openProjectModal(project);
    },
    onProximityChange: (project, dist) => {
      hud?.setProximity(project, dist);
    },
  });

  hud = new HudController(hudRoot, PORTFOLIO_PROJECTS, {
    onDriveToProject: (projectId) => {
      sceneManager.driveToProject(projectId);
    },
    onToggleTour: () => {
      return sceneManager.toggleAutonomousTour();
    },
    onToggleCameraMode: (mode) => {
      sceneManager.setCameraMode(mode);
    },
    onToggleAudio: () => {
      autoAudioAttempted = true;
      return sceneManager.toggleAudio();
    },
    onToggleHeadlights: () => {
      return sceneManager.toggleHeadlights();
    },
    onResetCar: () => {
      sceneManager.resetCar();
    },
  });

  const unlockAudioOnFirstGesture = (): void => {
    if (autoAudioAttempted) return;
    autoAudioAttempted = true;

    if (!sceneManager.isAudioEnabled()) {
      const enabled = sceneManager.toggleAudio();
      hud?.setAudioEnabledState(enabled);
    }

    viewportHost.removeEventListener('pointerdown', unlockAudioOnFirstGesture);
    window.removeEventListener('keydown', onFirstDrivingKey);
  };

  const onFirstDrivingKey = (ev: KeyboardEvent): void => {
    if (document.body.dataset.modalOpen === 'true') return;
    const drivingCodes = new Set([
      'KeyW',
      'KeyA',
      'KeyS',
      'KeyD',
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Space',
    ]);
    if (drivingCodes.has(ev.code)) {
      unlockAudioOnFirstGesture();
    }
  };

  viewportHost.addEventListener('pointerdown', unlockAudioOnFirstGesture, { passive: true });
  window.addEventListener('keydown', onFirstDrivingKey);

  window.addEventListener('beforeunload', () => {
    hud?.dispose();
    sceneManager.dispose();
  });
}

bootstrap();
