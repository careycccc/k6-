function distributePeople(totalPeople, levels) {
    if (levels <= 0 || totalPeople <= 0) return [];
    if (levels === 1) return [totalPeople];
    if (levels >= totalPeople) return Array.from({ length: levels }, (_, i) => (i < totalPeople ? 1 : 0));

    const weights = [];
    for (let i = 0; i < levels; i++) {
        weights.push(((levels - i) / levels) * (0.5 + Math.random()));
    }
    weights.sort((a, b) => b - a);
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    const result = weights.map(w => Math.max(1, Math.floor((w / totalWeight) * totalPeople)));
    
    let diff = totalPeople - result.reduce((s, n) => s + n, 0);
    while (diff > 0) { for (let i = 0; i < levels && diff > 0; i++) { result[i]++; diff--; } }
    while (diff < 0) { for (let i = levels - 1; i >= 0 && diff < 0; i--) { if (result[i] > 1) { result[i]--; diff++; } } }
    result.sort((a, b) => b - a);
    return result;
}

let vus = 3;
let subUsers = 19;
let totalGenerated = 0;
for (let vuId = 1; vuId <= vus; vuId++) {
    let myTotalUsers = Math.floor(subUsers / vus);
    if (vuId === vus) myTotalUsers += (subUsers % vus);
    let dist = distributePeople(myTotalUsers, 3);
    let sum = dist.reduce((a, b) => a + b, 0);
    totalGenerated += sum;
    console.log(`VU ${vuId}: myTotalUsers=${myTotalUsers}, dist=[${dist}], sum=${sum}`);
}
console.log(`Total generated across VUs: ${totalGenerated}`);
