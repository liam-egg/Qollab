"""IonQ native gates, their equivalences, and IonQ's rewrite passes.

Qollab's in-browser Python can't install the qiskit-ionq package, so the
three modules this project uses are bundled here, copied unmodified from
qiskit-ionq 1.1.1 (https://github.com/qiskit-community/qiskit-ionq,
Apache License 2.0, see LICENSE.txt in this folder):

- ionq_gates.py: GPI, GPI2, MS and ZZ gate definitions
- ionq_equivalence_library.py: U -> GPI2·GPI·GPI2 and CX -> MS + GPI2
- rewrite_rules.py: IonQ's native-gate rewrite passes

They depend only on Qiskit and NumPy. This __init__ file is the only new
code in the folder.
"""

from .ionq_equivalence_library import add_equivalences
from .ionq_gates import GPI2Gate, GPIGate, MSGate, ZZGate
from .rewrite_rules import (
    CancelGPI2Adjoint,
    CancelGPIAdjoint,
    CommuteGPIsThroughMS,
    CompactMoreThanThreeSingleQubitGates,
    FuseConsecutiveMS,
    GPI2TwiceIsGPI,
)

SOURCE_VERSION = "1.1.1"

__all__ = [
    "GPIGate", "GPI2Gate", "MSGate", "ZZGate", "add_equivalences",
    "CancelGPI2Adjoint", "CancelGPIAdjoint", "GPI2TwiceIsGPI",
    "CommuteGPIsThroughMS", "CompactMoreThanThreeSingleQubitGates", "FuseConsecutiveMS",
    "SOURCE_VERSION",
]
