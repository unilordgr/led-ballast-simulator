"""Line-by-line replica of the user's Excel sheet (Sheet1), used as the reference
for checking the JavaScript port. Pure stdlib. Cell names are the sheet's."""
import json, math, random

SCALE = {0:(0.2,0.025),1:(1.5,0.14),2:(3.3,6.8),3:(5.4,18.2),4:(7.9,39),5:(10.7,71.6),
         6:(13.8,119),7:(17.1,182.8),8:(20.7,267.8),9:(24.4,372.1),10:(28.4,504.1)}

def sheet(A4, B4, C4, D4, E4, F4):
    A7 = A4*2
    D7 = 1
    B7 = B4/D7
    E7 = SCALE[E4][1]                       # VLOOKUP(E4,I4:K27,3,0)
    F7 = 0.46 if F4 == "front" else 0.862
    A14 = A4*B4
    B14 = math.ceil(A7/2) if A7 % 2 == 0 else (A7+1)/2
    B10 = A14*C4
    C10 = 4*B7*B14 + 4.15*B14 + A4*7.9
    E10 = A14*E7/9.8
    B11 = 0.922 if F4 == "front" else 0
    C11 = 0.46
    D11 = 0.46 if F4 == "front" else 0.862
    E11 = B7*D7/2 + 0.1
    C14 = (E10*E11*D4 - B10*B11 - C10*C11)/D11
    D14 = C14/B14
    return dict(A7=A7,B7=B7,E7=E7,F7=F7,A14=A14,B14=B14,B10=B10,C10=C10,E10=E10,
                B11=B11,C11=C11,D11=D11,E11=E11,C14=C14,D14=D14)

if __name__ == "__main__":
    base = sheet(14, 7, 26.4, 1.5, 2, "rear")
    print("sheet default:", json.dumps(base, indent=1))
    random.seed(7)
    cases = []
    for _ in range(60):
        W = random.choice([2,3,4,5,6,8,10,12,14,16,20,24])
        H = random.choice([1,2,3,4,5,6,7,8,10])
        kg = round(random.uniform(10, 45), 1)
        SF = random.choice([1.2, 1.3, 1.4, 1.5])
        sc = random.choice([0,1,2,3,4,5,6])
        d = random.choice(["rear","front"])
        cases.append(dict(W=W,H=H,kg=kg,SF=SF,scale=sc,dir=d,out=sheet(W,H,kg,SF,sc,d)))
    cases.insert(0, dict(W=14,H=7,kg=26.4,SF=1.5,scale=2,dir="rear",out=base))
    json.dump(cases, open(__file__.replace("sheet_ref.py","sheet_cases.json"),"w"), indent=1)
    print("wrote", len(cases), "cases")
