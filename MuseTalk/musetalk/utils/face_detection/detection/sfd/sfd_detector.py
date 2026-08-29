import os
import cv2
from torch.utils.model_zoo import load_url

from ..core import FaceDetector

from .net_s3fd import s3fd
from .bbox import *
from .detect import *

models_urls = {
    's3fd_github': 'https://github.com/1adrianb/face-alignment/releases/download/v1.0.1/s3fd-619a316812.pth',
    's3fd_hf': 'https://huggingface.co/radames/MuseTalk/resolve/main/models/face-alignment/s3fd-619a316812.pth',
    's3fd': 'https://www.adrianbulat.com/downloads/python-fan/s3fd-619a316812.pth',
}


class SFDDetector(FaceDetector):
    def __init__(self, device, path_to_detector=os.path.join(os.path.dirname(os.path.abspath(__file__)), 's3fd.pth'), verbose=False):
        super(SFDDetector, self).__init__(device, verbose)

        # 1. Search candidate local paths first
        candidate_paths = [
            path_to_detector,
            os.path.expanduser('~/.cache/torch/hub/checkpoints/s3fd-619a316812.pth'),
            os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../../models/face-alignment/s3fd-619a316812.pth'),
            os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../../../models/dwpose/s3fd-619a316812.pth'),
        ]
        
        model_weights = None
        for p in candidate_paths:
            if os.path.isfile(p) and os.path.getsize(p) > 1000000:
                try:
                    model_weights = torch.load(p, map_location='cpu')
                    break
                except Exception:
                    pass

        # 2. If not found locally, download with multiple mirror fallbacks
        if model_weights is None:
            for url_key, url in models_urls.items():
                try:
                    print(f"[SFDDetector] Downloading s3fd checkpoint from {url_key}...")
                    model_weights = load_url(url, map_location='cpu')
                    if model_weights is not None:
                        break
                except Exception as dl_err:
                    print(f"[SFDDetector WARNING] Failed downloading from {url_key}: {dl_err}")

        if model_weights is None:
            raise RuntimeError("Could not load s3fd face detector weights. Please check network connection or download s3fd-619a316812.pth manually.")

        self.face_detector = s3fd()
        self.face_detector.load_state_dict(model_weights)
        self.face_detector.to(device)
        self.face_detector.eval()

    def detect_from_image(self, tensor_or_path):
        image = self.tensor_or_path_to_ndarray(tensor_or_path)

        bboxlist = detect(self.face_detector, image, device=self.device)
        keep = nms(bboxlist, 0.3)
        bboxlist = bboxlist[keep, :]
        bboxlist = [x for x in bboxlist if x[-1] > 0.5]

        return bboxlist

    def detect_from_batch(self, images):
        bboxlists = batch_detect(self.face_detector, images, device=self.device)
        keeps = [nms(bboxlists[:, i, :], 0.3) for i in range(bboxlists.shape[1])]
        bboxlists = [bboxlists[keep, i, :] for i, keep in enumerate(keeps)]
        bboxlists = [[x for x in bboxlist if x[-1] > 0.5] for bboxlist in bboxlists]

        return bboxlists

    @property
    def reference_scale(self):
        return 195

    @property
    def reference_x_shift(self):
        return 0

    @property
    def reference_y_shift(self):
        return 0
